const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { HttpError, wrap, audit, notify, int, str } = require('../utils/helpers');
const { overlaps, describe, toMin } = require('../utils/schedule');

router.use(authenticate);

const BASE_SQL = `
  SELECT c.id, c.code, c.title, c.description, c.credit_hours, c.capacity, c.status,
         c.department_id, c.semester_id, c.instructor_id,
         d.name department_name, s.name semester_name, s.registration_open,
         u.full_name instructor_name, u.email instructor_email,
         (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'enrolled') enrolled_count,
         (SELECT COUNT(*) FROM waitlists w WHERE w.course_id = c.id) waitlist_count
    FROM courses c
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN semesters s ON s.id = c.semester_id
    LEFT JOIN users u ON u.id = c.instructor_id`;

async function attachDetails(courses, user) {
  if (!courses.length) return courses;
  const ids = courses.map((c) => c.id);
  const [slots] = await db.query('SELECT id, course_id, day_of_week, start_time, end_time, room FROM timetables WHERE course_id IN (?) ORDER BY day_of_week, start_time', [ids]);
  const [pre] = await db.query('SELECT p.course_id, c.id, c.code, c.title FROM course_prerequisites p JOIN courses c ON c.id = p.prerequisite_id WHERE p.course_id IN (?)', [ids]);
  let mine = {};
  if (user.role === 'student') {
    const [en] = await db.execute('SELECT course_id, status FROM enrollments WHERE student_id = ? AND status <> ?', [user.id, 'withdrawn']);
    const [wl] = await db.execute('SELECT course_id FROM waitlists WHERE student_id = ?', [user.id]);
    en.forEach((e) => { mine[e.course_id] = e.status; });
    wl.forEach((w) => { mine[w.course_id] = 'waitlisted'; });
  }
  courses.forEach((c) => {
    c.slots = slots.filter((s) => s.course_id === c.id);
    c.prerequisites = pre.filter((p) => p.course_id === c.id).map(({ id, code, title }) => ({ id, code, title }));
    c.seats_left = Math.max(0, c.capacity - c.enrolled_count);
    if (user.role === 'student') c.my_status = mine[c.id] || null;
  });
  return courses;
}

router.get('/', wrap(async (req, res) => {
  const where = []; const params = [];
  if (req.query.search) { where.push('(c.title LIKE ? OR c.code LIKE ?)'); const q = `%${str(req.query.search, 60)}%`; params.push(q, q); }
  if (int(req.query.department_id)) { where.push('c.department_id = ?'); params.push(int(req.query.department_id)); }
  if (int(req.query.semester_id)) { where.push('c.semester_id = ?'); params.push(int(req.query.semester_id)); }
  if (['open', 'closed'].includes(req.query.status)) { where.push('c.status = ?'); params.push(req.query.status); }
  const [rows] = await db.execute(`${BASE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.code`, params);
  res.json({ courses: await attachDetails(rows, req.user) });
}));

// Reference data for filters and forms (departments, semesters, faculty list, all courses)
router.get('/meta/lookups', wrap(async (req, res) => {
  const [departments] = await db.execute('SELECT id, name, code FROM departments ORDER BY name');
  const [semesters] = await db.execute('SELECT id, name, start_date, end_date, registration_open, is_current FROM semesters ORDER BY start_date DESC');
  const [faculty] = await db.execute("SELECT id, full_name, department_id FROM users WHERE role = 'faculty' AND status = 'active' ORDER BY full_name");
  const [courses] = await db.execute('SELECT id, code, title FROM courses ORDER BY code');
  res.json({ departments, semesters, faculty, courses });
}));

router.get('/:id', wrap(async (req, res) => {
  const [rows] = await db.execute(`${BASE_SQL} WHERE c.id = ?`, [int(req.params.id)]);
  if (!rows.length) throw new HttpError(404, 'Course not found.');
  res.json({ course: (await attachDetails(rows, req.user))[0] });
}));

// ---------- Admin-only course management ----------
function parseCourse(b) {
  const code = str(b.code, 20).toUpperCase();
  const title = str(b.title, 150);
  const credit = int(b.credit_hours); const capacity = int(b.capacity);
  if (!/^[A-Z0-9][A-Z0-9 \-]{1,19}$/.test(code)) throw new HttpError(400, 'Course code must be 2-20 letters, numbers or dashes (e.g. CS-301).');
  if (title.length < 3) throw new HttpError(400, 'Course title must be at least 3 characters.');
  if (!credit || credit < 1 || credit > 6) throw new HttpError(400, 'Credit hours must be between 1 and 6.');
  if (!capacity || capacity < 1 || capacity > 500) throw new HttpError(400, 'Capacity must be between 1 and 500.');
  const status = b.status === 'closed' ? 'closed' : 'open';
  const prerequisites = [...new Set((Array.isArray(b.prerequisites) ? b.prerequisites : []).map(int).filter(Boolean))];
  const slots = (Array.isArray(b.slots) ? b.slots : []).map((s) => {
    const day = int(s.day_of_week);
    const ok = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!day || day < 1 || day > 6 || !ok.test(s.start_time) || !ok.test(s.end_time) || toMin(s.start_time) >= toMin(s.end_time))
      throw new HttpError(400, 'Each class slot needs a day and a start time earlier than its end time.');
    return { day_of_week: day, start_time: s.start_time, end_time: s.end_time, room: str(s.room, 30) || null };
  });
  return { code, title, description: str(b.description, 2000) || null, credit_hours: credit, capacity, status,
    department_id: int(b.department_id), semester_id: int(b.semester_id), instructor_id: int(b.instructor_id), prerequisites, slots };
}

async function validateAndSave(conn, id, c) {
  if (c.instructor_id) {
    const [f] = await conn.execute("SELECT id FROM users WHERE id = ? AND role = 'faculty' AND status = 'active'", [c.instructor_id]);
    if (!f.length) throw new HttpError(400, 'The selected instructor must be an active faculty member.');
  }
  if (c.prerequisites.includes(id)) throw new HttpError(400, 'A course cannot be its own prerequisite.');
  // instructor / room clashes with other courses in the same semester
  if (c.slots.length) {
    const [others] = await conn.execute(
      `SELECT t.day_of_week, t.start_time, t.end_time, t.room, co.code, co.instructor_id
         FROM timetables t JOIN courses co ON co.id = t.course_id WHERE co.id <> ? AND co.semester_id <=> ?`, [id || 0, c.semester_id]);
    for (const s of c.slots) for (const o of others) {
      if (!overlaps(s, o)) continue;
      if (c.instructor_id && o.instructor_id === c.instructor_id) throw new HttpError(409, `Instructor is already teaching ${o.code} at ${describe(o)}.`);
      if (s.room && o.room === s.room) throw new HttpError(409, `Room ${s.room} is already booked for ${o.code} at ${describe(o)}.`);
    }
  }
  const f = [c.code, c.title, c.description, c.credit_hours, c.department_id, c.semester_id, c.instructor_id, c.capacity, c.status];
  if (id) {
    const [[cnt]] = await conn.execute("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'enrolled'", [id]);
    if (c.capacity < cnt.n) throw new HttpError(422, `Capacity cannot be lower than the ${cnt.n} students already enrolled.`);
    await conn.execute(`UPDATE courses SET code=?, title=?, description=?, credit_hours=?, department_id=?, semester_id=?, instructor_id=?, capacity=?, status=? WHERE id=?`, [...f, id]);
    await conn.execute('DELETE FROM course_prerequisites WHERE course_id = ?', [id]);
    await conn.execute('DELETE FROM timetables WHERE course_id = ?', [id]);
  } else {
    const [r] = await conn.execute(`INSERT INTO courses (code, title, description, credit_hours, department_id, semester_id, instructor_id, capacity, status) VALUES (?,?,?,?,?,?,?,?,?)`, f);
    id = r.insertId;
  }
  for (const p of c.prerequisites) await conn.execute('INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES (?, ?)', [id, p]);
  for (const s of c.slots) await conn.execute('INSERT INTO timetables (course_id, day_of_week, start_time, end_time, room) VALUES (?,?,?,?,?)', [id, s.day_of_week, s.start_time, s.end_time, s.room]);
  return id;
}

async function save(req, res, id) {
  const c = parseCourse(req.body);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [dupe] = await conn.execute('SELECT id FROM courses WHERE code = ? AND id <> ?', [c.code, id || 0]);
    if (dupe.length) throw new HttpError(409, `A course with code ${c.code} already exists.`);
    const savedId = await validateAndSave(conn, id, c);
    await conn.commit();
    await audit(req.user.id, id ? 'COURSE_UPDATE' : 'COURSE_CREATE', `${c.code} - ${c.title}`, req.ip);
    if (id && c.instructor_id) await notify(c.instructor_id, 'Course updated', `${c.code} was updated by the administrator.`, 'info');
    res.status(id ? 200 : 201).json({ message: id ? 'Course updated.' : 'Course created.', id: savedId });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

router.post('/', authorize('admin'), wrap((req, res) => save(req, res, null)));
router.put('/:id', authorize('admin'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const [r] = await db.execute('SELECT id FROM courses WHERE id = ?', [id]);
  if (!r.length) throw new HttpError(404, 'Course not found.');
  await save(req, res, id);
}));
router.delete('/:id', authorize('admin'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const [r] = await db.execute('SELECT code, title FROM courses WHERE id = ?', [id]);
  if (!r.length) throw new HttpError(404, 'Course not found.');
  await db.execute('DELETE FROM courses WHERE id = ?', [id]);
  await audit(req.user.id, 'COURSE_DELETE', `${r[0].code} - ${r[0].title}`, req.ip);
  res.json({ message: 'Course deleted.' });
}));

module.exports = router;
