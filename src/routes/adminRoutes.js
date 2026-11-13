const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { HttpError, wrap, audit, notify, int, str, isEmail, passwordProblem, toCsv } = require('../utils/helpers');
const { overlaps } = require('../utils/schedule');

router.use(authenticate, authorize('admin'));
const semNo = (v) => { const n = int(v); return n && n >= 1 && n <= 12 ? n : null; };

// ---------- Overview & analytics ----------
router.get('/stats', wrap(async (req, res) => {
  const one = async (sql) => (await db.execute(sql))[0][0].n;
  const [perCourse] = await db.execute(
    `SELECT c.code, c.title, c.capacity, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status='enrolled') enrolled,
            (SELECT COUNT(*) FROM waitlists w WHERE w.course_id = c.id) waitlisted
       FROM courses c ORDER BY enrolled DESC, c.code`);
  const [perDept] = await db.execute(
    `SELECT d.name, COUNT(e.id) enrolments FROM departments d LEFT JOIN users u ON u.department_id = d.id AND u.role = 'student'
       LEFT JOIN enrollments e ON e.student_id = u.id AND e.status = 'enrolled' GROUP BY d.id, d.name ORDER BY enrolments DESC`);
  const [trend] = await db.execute(
    `SELECT DATE(enrolled_at) day, COUNT(*) n FROM enrollments WHERE enrolled_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(enrolled_at) ORDER BY day`);
  const [recent] = await db.execute('SELECT a.action, a.details, a.created_at, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 8');
  res.json({
    totals: {
      students: await one("SELECT COUNT(*) n FROM users WHERE role='student'"),
      faculty: await one("SELECT COUNT(*) n FROM users WHERE role='faculty'"),
      departments: await one('SELECT COUNT(*) n FROM departments'),
      courses: await one('SELECT COUNT(*) n FROM courses'),
      active_enrolments: await one("SELECT COUNT(*) n FROM enrollments WHERE status='enrolled'"),
      open_tickets: await one("SELECT COUNT(*) n FROM support_tickets WHERE status <> 'resolved'"),
      suspended: await one("SELECT COUNT(*) n FROM users WHERE status='suspended'"),
      waitlisted: await one('SELECT COUNT(*) n FROM waitlists')
    },
    per_course: perCourse,
    nearly_full: perCourse.filter((c) => c.enrolled / c.capacity >= 0.8),
    per_department: perDept, trend, recent_activity: recent
  });
}));

// ---------- Users ----------
router.get('/users', wrap(async (req, res) => {
  const where = []; const p = [];
  if (['student', 'faculty', 'admin'].includes(req.query.role)) { where.push('u.role = ?'); p.push(req.query.role); }
  if (['active', 'suspended'].includes(req.query.status)) { where.push('u.status = ?'); p.push(req.query.status); }
  if (req.query.search) { where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.reg_no LIKE ?)'); const q = `%${str(req.query.search, 60)}%`; p.push(q, q, q); }
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.role, u.status, u.reg_no, u.program, u.semester_no, u.department_id, d.name department_name, u.created_at, u.last_login
       FROM users u LEFT JOIN departments d ON d.id = u.department_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.created_at DESC LIMIT 500`, p);
  res.json({ users: rows });
}));

router.post('/users', wrap(async (req, res) => {   // the only way to create faculty/admin accounts
  const full_name = str(req.body.full_name, 100), email = str(req.body.email, 150).toLowerCase();
  const role = ['student', 'faculty', 'admin'].includes(req.body.role) ? req.body.role : null;
  if (full_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
  if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (!role) throw new HttpError(400, 'Choose a role.');
  const problem = passwordProblem(req.body.password); if (problem) throw new HttpError(400, problem);
  const [dupe] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (dupe.length) throw new HttpError(409, 'An account with this email already exists.');
  const [r] = await db.execute('INSERT INTO users (full_name, email, password_hash, role, department_id, reg_no, program, semester_no) VALUES (?,?,?,?,?,?,?,?)',
    [full_name, email, await bcrypt.hash(req.body.password, 10), role, int(req.body.department_id), str(req.body.reg_no, 30) || null, str(req.body.program, 30) || null, semNo(req.body.semester_no)]);
  await audit(req.user.id, 'USER_CREATE', `${role}: ${email}`, req.ip);
  res.status(201).json({ message: `${role} account created.`, id: r.insertId });
}));

router.put('/users/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const [[u]] = await db.execute('SELECT id, role, email FROM users WHERE id = ?', [id]);
  if (!u) throw new HttpError(404, 'User not found.');
  const role = ['student', 'faculty', 'admin'].includes(req.body.role) ? req.body.role : u.role;
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  if (id === req.user.id && (role !== 'admin' || status !== 'active')) throw new HttpError(400, 'You cannot demote or suspend your own account.');
  const full_name = str(req.body.full_name, 100);
  if (full_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
  await db.execute('UPDATE users SET full_name=?, role=?, status=?, department_id=?, reg_no=?, program=?, semester_no=? WHERE id=?',
    [full_name, role, status, int(req.body.department_id), str(req.body.reg_no, 30) || null, str(req.body.program, 30) || null, semNo(req.body.semester_no), id]);
  await audit(req.user.id, 'USER_UPDATE', `${u.email} -> role ${role}, status ${status}`, req.ip);
  res.json({ message: 'User updated.' });
}));

router.put('/users/:id/password', wrap(async (req, res) => {
  const problem = passwordProblem(req.body.new_password); if (problem) throw new HttpError(400, problem);
  const [r] = await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(req.body.new_password, 10), int(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'User not found.');
  await audit(req.user.id, 'PASSWORD_RESET', `User ${req.params.id}`, req.ip);
  res.json({ message: 'Password reset.' });
}));

// ---------- Departments ----------
router.get('/departments', wrap(async (req, res) => {
  const [rows] = await db.execute(`SELECT d.*, (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) courses,
    (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role='student') students,
    (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role='faculty') faculty FROM departments d ORDER BY d.name`);
  res.json({ departments: rows });
}));
router.post('/departments', wrap(async (req, res) => {
  const name = str(req.body.name, 120), code = str(req.body.code, 10).toUpperCase();
  if (name.length < 3 || !/^[A-Z0-9]{2,10}$/.test(code)) throw new HttpError(400, 'Enter a department name and a 2-10 character code.');
  await db.execute('INSERT INTO departments (name, code) VALUES (?,?)', [name, code]);
  await audit(req.user.id, 'DEPARTMENT_CREATE', name, req.ip);
  res.status(201).json({ message: 'Department created.' });
}));
router.put('/departments/:id', wrap(async (req, res) => {
  const name = str(req.body.name, 120), code = str(req.body.code, 10).toUpperCase();
  if (name.length < 3 || !/^[A-Z0-9]{2,10}$/.test(code)) throw new HttpError(400, 'Enter a department name and a 2-10 character code.');
  await db.execute('UPDATE departments SET name=?, code=? WHERE id=?', [name, code, int(req.params.id)]);
  res.json({ message: 'Department updated.' });
}));
router.delete('/departments/:id', wrap(async (req, res) => {
  await db.execute('DELETE FROM departments WHERE id = ?', [int(req.params.id)]);
  await audit(req.user.id, 'DEPARTMENT_DELETE', `id ${req.params.id}`, req.ip);
  res.json({ message: 'Department deleted.' });
}));

// ---------- Semesters ----------
router.get('/semesters', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT s.*, (SELECT COUNT(*) FROM courses c WHERE c.semester_id = s.id) courses FROM semesters s ORDER BY start_date DESC');
  res.json({ semesters: rows });
}));
async function saveSemester(req, res, id) {
  const name = str(req.body.name, 60), s = req.body.start_date, e = req.body.end_date;
  if (name.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(s || '') || !/^\d{4}-\d{2}-\d{2}$/.test(e || '') || s >= e)
    throw new HttpError(400, 'Enter a name and a start date that is before the end date.');
  const open = req.body.registration_open ? 1 : 0, current = req.body.is_current ? 1 : 0;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (current) await conn.execute('UPDATE semesters SET is_current = 0');
    if (id) await conn.execute('UPDATE semesters SET name=?, start_date=?, end_date=?, registration_open=?, is_current=? WHERE id=?', [name, s, e, open, current, id]);
    else await conn.execute('INSERT INTO semesters (name, start_date, end_date, registration_open, is_current) VALUES (?,?,?,?,?)', [name, s, e, open, current]);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  await audit(req.user.id, id ? 'SEMESTER_UPDATE' : 'SEMESTER_CREATE', name, req.ip);
  res.status(id ? 200 : 201).json({ message: id ? 'Semester updated.' : 'Semester created.' });
}
router.post('/semesters', wrap((req, res) => saveSemester(req, res, null)));
router.put('/semesters/:id', wrap((req, res) => saveSemester(req, res, int(req.params.id))));
router.delete('/semesters/:id', wrap(async (req, res) => {
  await db.execute('DELETE FROM semesters WHERE id = ?', [int(req.params.id)]);
  res.json({ message: 'Semester deleted.' });
}));

// ---------- Academic calendar ----------
router.post('/calendar', wrap(async (req, res) => {
  const title = str(req.body.title, 150);
  const type = ['deadline', 'exam', 'holiday', 'semester', 'event'].includes(req.body.type) ? req.body.type : 'event';
  if (title.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(req.body.event_date || '')) throw new HttpError(400, 'Enter a title and a valid date.');
  await db.execute('INSERT INTO calendar_events (title, event_date, type, description, created_by) VALUES (?,?,?,?,?)', [title, req.body.event_date, type, str(req.body.description, 300) || null, req.user.id]);
  res.status(201).json({ message: 'Calendar event added.' });
}));
router.delete('/calendar/:id', wrap(async (req, res) => {
  await db.execute('DELETE FROM calendar_events WHERE id = ?', [int(req.params.id)]);
  res.json({ message: 'Event removed.' });
}));

// ---------- Enrolment monitoring ----------
router.get('/enrollments', wrap(async (req, res) => {
  const cid = int(req.query.course_id);
  const [rows] = await db.execute(
    `SELECT e.id, e.status, e.enrolled_at, e.grade_letter, u.full_name, u.email, c.code, c.title
       FROM enrollments e JOIN users u ON u.id = e.student_id JOIN courses c ON c.id = e.course_id
      ${cid ? 'WHERE e.course_id = ?' : ''} ORDER BY e.enrolled_at DESC LIMIT 300`, cid ? [cid] : []);
  res.json({ enrollments: rows });
}));

// ---------- Announcements ----------
router.get('/announcements', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT a.id, a.title, a.message, a.audience, a.created_at, u.full_name author FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.course_id IS NULL ORDER BY a.created_at DESC LIMIT 100');
  res.json({ announcements: rows });
}));
router.post('/announcements', wrap(async (req, res) => {
  const title = str(req.body.title, 150), message = str(req.body.message, 3000);
  const audience = ['all', 'students', 'faculty'].includes(req.body.audience) ? req.body.audience : 'all';
  if (title.length < 3 || message.length < 5) throw new HttpError(400, 'Add a title and a message.');
  await db.execute('INSERT INTO announcements (title, message, author_id, audience) VALUES (?,?,?,?)', [title, message, req.user.id, audience]);
  const roleFilter = audience === 'all' ? "role IN ('student','faculty')" : `role = '${audience === 'students' ? 'student' : 'faculty'}'`;
  const [targets] = await db.execute(`SELECT id FROM users WHERE status = 'active' AND ${roleFilter}`);
  await notify(targets.map((t) => t.id), title, message.slice(0, 200), 'info');
  await audit(req.user.id, 'ANNOUNCEMENT', title, req.ip);
  res.status(201).json({ message: `Announcement published to ${targets.length} users.` });
}));
router.delete('/announcements/:id', wrap(async (req, res) => {
  await db.execute('DELETE FROM announcements WHERE id = ? AND course_id IS NULL', [int(req.params.id)]);
  res.json({ message: 'Announcement deleted.' });
}));

// ---------- Helpdesk ----------
router.get('/tickets', wrap(async (req, res) => {
  const [rows] = await db.execute(`SELECT t.*, u.full_name, u.email, d.name department_name FROM support_tickets t JOIN users u ON u.id = t.student_id
    LEFT JOIN departments d ON d.id = t.department_id ORDER BY FIELD(t.status,'open','in_progress','resolved'), t.created_at DESC LIMIT 200`);
  res.json({ tickets: rows });
}));
router.put('/tickets/:id', wrap(async (req, res) => {
  const status = ['open', 'in_progress', 'resolved'].includes(req.body.status) ? req.body.status : null;
  if (!status) throw new HttpError(400, 'Choose a valid status.');
  const [[t]] = await db.execute('SELECT student_id, subject FROM support_tickets WHERE id = ?', [int(req.params.id)]);
  if (!t) throw new HttpError(404, 'Ticket not found.');
  await db.execute('UPDATE support_tickets SET status=?, department_id=?, response=? WHERE id=?', [status, int(req.body.department_id), str(req.body.response, 2000) || null, int(req.params.id)]);
  await notify(t.student_id, 'Support ticket updated', `"${t.subject}" is now ${status.replace('_', ' ')}.`, status === 'resolved' ? 'success' : 'info');
  res.json({ message: 'Ticket updated.' });
}));

// ---------- Audit logs, settings, reports ----------
router.get('/audit-logs', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT a.id, a.action, a.details, a.ip, a.created_at, u.full_name, u.email FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200');
  res.json({ logs: rows });
}));
router.get('/settings', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT k, v FROM settings'); res.json({ settings: Object.fromEntries(rows.map((r) => [r.k, Number(r.v)])) });
}));
router.put('/settings', wrap(async (req, res) => {
  const lim = { max_credits: [1, 30], attendance_threshold: [0, 100], passing_percentage: [0, 100] };
  for (const [k, [lo, hi]] of Object.entries(lim)) {
    if (req.body[k] === undefined) continue;
    const v = Number(req.body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}.`);
    await db.execute('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v)]);
  }
  await audit(req.user.id, 'SETTINGS_UPDATE', JSON.stringify(req.body).slice(0, 200), req.ip);
  res.json({ message: 'Settings saved.' });
}));
router.get('/reports/:type', wrap(async (req, res) => {
  let rows, cols;
  if (req.params.type === 'enrolments') {
    [rows] = await db.execute(`SELECT c.code, c.title, d.name department, u.full_name instructor, c.capacity,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id AND e.status='enrolled') enrolled,
      (SELECT COUNT(*) FROM waitlists w WHERE w.course_id=c.id) waitlisted FROM courses c LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN users u ON u.id=c.instructor_id ORDER BY c.code`);
    cols = ['code', 'title', 'department', 'instructor', 'capacity', 'enrolled', 'waitlisted'];
  } else if (req.params.type === 'students') {
    [rows] = await db.execute(`SELECT u.reg_no, u.full_name, u.email, d.name department, u.status,
      (SELECT COUNT(*) FROM enrollments e WHERE e.student_id=u.id AND e.status='enrolled') courses,
      (SELECT ROUND(SUM(e.grade_points*c.credit_hours)/NULLIF(SUM(c.credit_hours),0),2) FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=u.id AND e.status='completed') cgpa
      FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.role='student' ORDER BY u.full_name`);
    cols = ['reg_no', 'full_name', 'email', 'department', 'status', 'courses', 'cgpa'];
  } else throw new HttpError(404, 'Unknown report.');
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`).send('\uFEFF' + toCsv(rows, cols));
}));

// ---------- Smart timetable generator (greedy, conflict-free) ----------
const ROOMS = ['A-101', 'A-102', 'B-201', 'B-202', 'Lab-1', 'Lab-2'];
const TIMES = [['08:30', '10:00'], ['10:00', '11:30'], ['11:30', '13:00'], ['14:00', '15:30'], ['15:30', '17:00']];
const PATTERNS = [[1, 3], [2, 4], [3, 5], [1, 4], [2, 5]];
router.post('/timetable/generate', wrap(async (req, res) => {
  const sem = int(req.body.semester_id);
  if (!sem) throw new HttpError(400, 'Choose a semester.');
  const [courses] = await db.execute('SELECT id, code, instructor_id, department_id FROM courses WHERE semester_id = ? ORDER BY code', [sem]);
  const [existing] = await db.execute('SELECT t.*, c.instructor_id, c.department_id FROM timetables t JOIN courses c ON c.id = t.course_id WHERE c.semester_id = ?', [sem]);
  const scheduled = new Set(existing.map((e) => e.course_id));
  const placed = [], failed = [];
  for (const c of courses.filter((x) => !scheduled.has(x.id))) {
    let done = false;
    for (const strict of [true, false]) {
      for (const days of PATTERNS) for (const [st, en] of TIMES) {
        if (done) break;
        const cand = days.map((d) => ({ day_of_week: d, start_time: st, end_time: en }));
        const clash = (fn) => existing.some((o) => cand.some((s) => overlaps(s, o) && fn(o)));
        if (c.instructor_id && clash((o) => o.instructor_id === c.instructor_id)) continue;
        if (strict && c.department_id && clash((o) => o.department_id === c.department_id)) continue;
        const room = ROOMS.find((r) => !clash((o) => o.room === r));
        if (!room) continue;
        for (const s of cand) {
          await db.execute('INSERT INTO timetables (course_id, day_of_week, start_time, end_time, room) VALUES (?,?,?,?,?)', [c.id, s.day_of_week, st, en, room]);
          existing.push({ ...s, course_id: c.id, room, instructor_id: c.instructor_id, department_id: c.department_id });
        }
        placed.push(c.code); done = true;
      }
      if (done) break;
    }
    if (!done) failed.push(c.code);
  }
  await audit(req.user.id, 'TIMETABLE_GENERATE', `placed ${placed.length}, failed ${failed.length}`, req.ip);
  res.json({ message: `Scheduled ${placed.length} course(s).` + (failed.length ? ` Could not place: ${failed.join(', ')}.` : ''), placed, failed });
}));

module.exports = router;
