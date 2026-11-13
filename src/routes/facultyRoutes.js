const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { HttpError, wrap, audit, notify, getSetting, int, str } = require('../utils/helpers');
const { gradeFromPercentage } = require('../utils/grading');

router.use(authenticate, authorize('faculty'));

// Faculty may only touch courses assigned to them.
async function ownCourse(req, res, next) {
  try {
    const [r] = await db.execute('SELECT id, code, title, capacity FROM courses WHERE id = ? AND instructor_id = ?', [int(req.params.id), req.user.id]);
    if (!r.length) return res.status(403).json({ error: 'You can only manage courses assigned to you.', code: 'FORBIDDEN' });
    req.course = r[0]; next();
  } catch (e) { next(e); }
}
const studentIds = async (courseId) => {
  const [r] = await db.execute("SELECT student_id FROM enrollments WHERE course_id = ? AND status = 'enrolled'", [courseId]);
  return r.map((x) => x.student_id);
};

router.get('/dashboard', wrap(async (req, res) => {
  const [courses] = await db.execute(
    `SELECT c.id, c.code, c.title, c.credit_hours, c.capacity, s.name semester_name,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'enrolled') students
       FROM courses c LEFT JOIN semesters s ON s.id = c.semester_id WHERE c.instructor_id = ? ORDER BY c.code`, [req.user.id]);
  const [[ungraded]] = await db.execute(
    `SELECT COUNT(*) n FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id
      WHERE c.instructor_id = ? AND s.status IN ('submitted','late')`, [req.user.id]);
  const [[up]] = await db.execute(
    `SELECT COUNT(*) n FROM assignments a JOIN courses c ON c.id = a.course_id WHERE c.instructor_id = ? AND a.due_date >= NOW()`, [req.user.id]);
  const [schedule] = await db.execute(
    `SELECT t.day_of_week, t.start_time, t.end_time, t.room, c.code, c.title FROM timetables t JOIN courses c ON c.id = t.course_id
      WHERE c.instructor_id = ? ORDER BY t.day_of_week, t.start_time`, [req.user.id]);
  res.json({
    stats: { courses: courses.length, students: courses.reduce((a, c) => a + c.students, 0), to_grade: ungraded.n, open_assignments: up.n },
    courses, schedule
  });
}));

router.get('/courses/:id/students', ownCourse, wrap(async (req, res) => {
  const threshold = await getSetting('attendance_threshold', 75);
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.reg_no,
            (SELECT COUNT(*) FROM attendance a WHERE a.course_id = e.course_id AND a.student_id = u.id) classes,
            (SELECT COUNT(*) FROM attendance a WHERE a.course_id = e.course_id AND a.student_id = u.id AND a.status IN ('present','late')) attended,
            e.status, e.grade_letter, e.final_percentage
       FROM enrollments e JOIN users u ON u.id = e.student_id
      WHERE e.course_id = ? AND e.status IN ('enrolled','completed') ORDER BY u.full_name`, [req.course.id]);
  rows.forEach((r) => { r.attendance = r.classes ? Math.round(r.attended / r.classes * 1000) / 10 : null; });
  res.json({ course: req.course, threshold, students: rows });
}));

// ----- Attendance -----
router.get('/courses/:id/attendance', ownCourse, wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  const [rows] = await db.execute(
    `SELECT u.id student_id, u.full_name, u.reg_no, a.status
       FROM enrollments e JOIN users u ON u.id = e.student_id
       LEFT JOIN attendance a ON a.student_id = u.id AND a.course_id = e.course_id AND a.class_date = ?
      WHERE e.course_id = ? AND e.status = 'enrolled' ORDER BY u.full_name`, [date, req.course.id]);
  const [dates] = await db.execute('SELECT DISTINCT class_date FROM attendance WHERE course_id = ? ORDER BY class_date DESC LIMIT 30', [req.course.id]);
  res.json({ date, records: rows, dates: dates.map((d) => d.class_date) });
}));

router.post('/courses/:id/attendance', ownCourse, wrap(async (req, res) => {
  const date = req.body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new HttpError(400, 'A valid class date (YYYY-MM-DD) is required.');
  if (date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Attendance cannot be marked for a future date.');
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  if (!records.length) throw new HttpError(400, 'No attendance records were sent.');
  const valid = new Set(await studentIds(req.course.id));
  const rows = records.filter((r) => valid.has(int(r.student_id)) && ['present', 'absent', 'late'].includes(r.status))
    .map((r) => [req.course.id, int(r.student_id), date, r.status]);
  if (!rows.length) throw new HttpError(400, 'No valid records for enrolled students.');
  await db.query('INSERT INTO attendance (course_id, student_id, class_date, status) VALUES ? ON DUPLICATE KEY UPDATE status = VALUES(status)', [rows]);

  const threshold = await getSetting('attendance_threshold', 75);
  const [low] = await db.query(
    `SELECT a.student_id, ROUND(SUM(a.status IN ('present','late')) / COUNT(*) * 100, 1) pct FROM attendance a
      WHERE a.course_id = ? AND a.student_id IN (?) GROUP BY a.student_id HAVING pct < ?`, [req.course.id, rows.map((r) => r[1]), threshold]);
  for (const l of low) await notify(l.student_id, 'Low attendance warning', `Your attendance in ${req.course.code} is ${l.pct}% (minimum ${threshold}%).`, 'warning');
  await audit(req.user.id, 'ATTENDANCE', `${req.course.code} on ${date}`, req.ip);
  res.json({ message: `Attendance saved for ${rows.length} students.`, warned: low.length });
}));

// ----- Assignments & submissions -----
router.get('/courses/:id/assignments', ownCourse, wrap(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT a.*, (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) submissions,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status IN ('submitted','late')) to_grade
       FROM assignments a WHERE a.course_id = ? ORDER BY a.due_date DESC`, [req.course.id]);
  res.json({ assignments: rows });
}));

router.post('/courses/:id/assignments', ownCourse, wrap(async (req, res) => {
  const title = str(req.body.title, 150); const max = Number(req.body.max_marks);
  const due = String(req.body.due_date || '').replace('T', ' ').slice(0, 19);
  if (title.length < 3) throw new HttpError(400, 'Assignment title must be at least 3 characters.');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(due)) throw new HttpError(400, 'A valid due date and time is required.');
  if (!(max > 0 && max <= 1000)) throw new HttpError(400, 'Maximum marks must be between 1 and 1000.');
  const [r] = await db.execute('INSERT INTO assignments (course_id, title, description, due_date, max_marks) VALUES (?,?,?,?,?)',
    [req.course.id, title, str(req.body.description, 3000) || null, due.length === 16 ? due + ':00' : due, max]);
  await notify(await studentIds(req.course.id), 'New assignment', `${req.course.code}: "${title}" is due ${due.slice(0, 16)}.`, 'info');
  await audit(req.user.id, 'ASSIGNMENT_CREATE', `${req.course.code} - ${title}`, req.ip);
  res.status(201).json({ message: 'Assignment published.', id: r.insertId });
}));

router.get('/assignments/:aid/submissions', wrap(async (req, res) => {
  const [[a]] = await db.execute('SELECT a.id, a.title, a.max_marks, c.code FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = ? AND c.instructor_id = ?', [int(req.params.aid), req.user.id]);
  if (!a) throw new HttpError(403, 'You can only view submissions for your own courses.', 'FORBIDDEN');
  const [rows] = await db.execute(
    `SELECT s.id, s.status, s.submitted_at, s.marks, s.feedback, s.file_name, s.text_answer, u.full_name, u.reg_no
       FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? ORDER BY s.submitted_at`, [a.id]);
  res.json({ assignment: a, submissions: rows });
}));

router.put('/submissions/:sid/grade', wrap(async (req, res) => {
  const [[s]] = await db.execute(
    `SELECT s.id, s.student_id, a.title, a.max_marks, c.code FROM submissions s JOIN assignments a ON a.id = s.assignment_id
      JOIN courses c ON c.id = a.course_id WHERE s.id = ? AND c.instructor_id = ?`, [int(req.params.sid), req.user.id]);
  if (!s) throw new HttpError(403, 'You can only grade submissions in your own courses.', 'FORBIDDEN');
  const returned = req.body.status === 'returned';
  const marks = Number(req.body.marks);
  if (!returned && !(marks >= 0 && marks <= s.max_marks)) throw new HttpError(400, `Marks must be between 0 and ${s.max_marks}.`);
  await db.execute('UPDATE submissions SET marks = ?, feedback = ?, status = ? WHERE id = ?',
    [returned ? null : marks, str(req.body.feedback, 2000) || null, returned ? 'returned' : 'graded', s.id]);
  await notify(s.student_id, returned ? 'Assignment returned for revision' : 'Assignment graded',
    returned ? `${s.code}: "${s.title}" needs revision.` : `${s.code}: "${s.title}" scored ${marks}/${s.max_marks}.`, returned ? 'warning' : 'success');
  res.json({ message: returned ? 'Returned to student.' : 'Grade saved.' });
}));

// ----- Materials -----
router.get('/courses/:id/materials', ownCourse, wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT id, title, file_name, uploaded_at FROM materials WHERE course_id = ? ORDER BY uploaded_at DESC', [req.course.id]);
  res.json({ materials: rows });
}));
router.post('/courses/:id/materials', ownCourse, upload.materials.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Please choose a file to upload.');
  const title = str(req.body.title, 150) || req.file.originalname;
  await db.execute('INSERT INTO materials (course_id, title, file_path, file_name, uploaded_by) VALUES (?,?,?,?,?)',
    [req.course.id, title, req.file.filename, req.file.originalname.slice(0, 255), req.user.id]);
  await notify(await studentIds(req.course.id), 'New course material', `${req.course.code}: "${title}" was uploaded.`, 'info');
  res.status(201).json({ message: 'Material uploaded.' });
}));
router.delete('/courses/:id/materials/:mid', ownCourse, wrap(async (req, res) => {
  const [r] = await db.execute('DELETE FROM materials WHERE id = ? AND course_id = ?', [int(req.params.mid), req.course.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Material not found.');
  res.json({ message: 'Material removed.' });
}));

// ----- Grades -----
router.get('/courses/:id/grades', ownCourse, wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT g.*, u.full_name FROM grades g JOIN users u ON u.id = g.student_id WHERE g.course_id = ? ORDER BY g.created_at DESC', [req.course.id]);
  res.json({ grades: rows });
}));
router.post('/courses/:id/grades', ownCourse, wrap(async (req, res) => {
  const { component } = req.body; const marks = Number(req.body.marks), max = Number(req.body.max_marks), weight = Number(req.body.weight);
  const sid = int(req.body.student_id);
  if (!['quiz', 'assignment', 'midterm', 'final', 'project'].includes(component)) throw new HttpError(400, 'Choose a valid grade component.');
  if (!(max > 0) || !(marks >= 0 && marks <= max)) throw new HttpError(400, 'Marks must be between 0 and the maximum marks.');
  if (!(weight > 0 && weight <= 100)) throw new HttpError(400, 'Weight must be between 0 and 100.');
  if (!(await studentIds(req.course.id)).includes(sid)) throw new HttpError(400, 'That student is not enrolled in this course.');
  await db.execute('INSERT INTO grades (course_id, student_id, component, title, marks, max_marks, weight) VALUES (?,?,?,?,?,?,?)',
    [req.course.id, sid, component, str(req.body.title, 100) || component, marks, max, weight]);
  await notify(sid, 'New grade posted', `${req.course.code}: ${str(req.body.title, 100) || component} - ${marks}/${max}.`, 'success');
  res.status(201).json({ message: 'Grade saved.' });
}));
router.delete('/courses/:id/grades/:gid', ownCourse, wrap(async (req, res) => {
  await db.execute('DELETE FROM grades WHERE id = ? AND course_id = ?', [int(req.params.gid), req.course.id]);
  res.json({ message: 'Grade removed.' });
}));

// Finalise: weighted percentage -> letter grade + grade points, course marked completed for that student.
router.post('/courses/:id/final-grade', ownCourse, wrap(async (req, res) => {
  const sid = int(req.body.student_id);
  const [comps] = await db.execute('SELECT marks, max_marks, weight FROM grades WHERE course_id = ? AND student_id = ?', [req.course.id, sid]);
  if (!comps.length) throw new HttpError(400, 'Add at least one graded component before finalising.');
  const w = comps.reduce((s, c) => s + c.weight, 0);
  const pct = Math.round(comps.reduce((s, c) => s + (c.marks / c.max_marks) * c.weight, 0) / w * 10000) / 100;
  const { letter, points } = gradeFromPercentage(pct);
  const [r] = await db.execute("UPDATE enrollments SET status='completed', grade_letter=?, grade_points=?, final_percentage=? WHERE student_id=? AND course_id=? AND status='enrolled'", [letter, points, pct, sid, req.course.id]);
  if (!r.affectedRows) throw new HttpError(400, 'That student is not currently enrolled.');
  await notify(sid, 'Final grade released', `${req.course.code}: ${letter} (${pct}%).`, 'success');
  await audit(req.user.id, 'FINAL_GRADE', `${req.course.code} student ${sid}: ${letter}`, req.ip);
  res.json({ message: `Final grade ${letter} (${pct}%) published.`, letter, points, percentage: pct });
}));

// ----- Announcements -----
router.post('/courses/:id/announcements', ownCourse, wrap(async (req, res) => {
  const title = str(req.body.title, 150), message = str(req.body.message, 3000);
  if (title.length < 3 || message.length < 5) throw new HttpError(400, 'Add a title and a message.');
  await db.execute("INSERT INTO announcements (title, message, author_id, course_id, audience) VALUES (?,?,?,?,'students')", [title, message, req.user.id, req.course.id]);
  await notify(await studentIds(req.course.id), `${req.course.code}: ${title}`, message.slice(0, 200), 'info');
  res.status(201).json({ message: 'Announcement sent to your class.' });
}));

// ----- Performance report with explainable risk flags (insights, not predictions) -----
router.get('/courses/:id/report', ownCourse, wrap(async (req, res) => {
  const threshold = await getSetting('attendance_threshold', 75);
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.reg_no,
       (SELECT COUNT(*) FROM attendance a WHERE a.course_id = e.course_id AND a.student_id = u.id) classes,
       (SELECT COUNT(*) FROM attendance a WHERE a.course_id = e.course_id AND a.student_id = u.id AND a.status IN ('present','late')) attended,
       (SELECT COUNT(*) FROM assignments x WHERE x.course_id = e.course_id AND x.due_date < NOW()) due_assignments,
       (SELECT COUNT(*) FROM submissions s JOIN assignments x ON x.id = s.assignment_id WHERE x.course_id = e.course_id AND s.student_id = u.id) submitted,
       (SELECT SUM(g.marks / g.max_marks * g.weight) / SUM(g.weight) * 100 FROM grades g WHERE g.course_id = e.course_id AND g.student_id = u.id) avg_pct
     FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ? AND e.status = 'enrolled' ORDER BY u.full_name`, [req.course.id]);
  const pass = await getSetting('passing_percentage', 50);
  rows.forEach((r) => {
    r.attendance = r.classes ? Math.round(r.attended / r.classes * 1000) / 10 : null;
    r.avg_pct = r.avg_pct === null ? null : Math.round(r.avg_pct * 10) / 10;
    r.reasons = [];
    if (r.attendance !== null && r.attendance < threshold) r.reasons.push(`Attendance ${r.attendance}% is below ${threshold}%`);
    if (r.due_assignments > 0 && r.submitted < r.due_assignments) r.reasons.push(`Missing ${r.due_assignments - r.submitted} of ${r.due_assignments} due assignments`);
    if (r.avg_pct !== null && r.avg_pct < pass + 10) r.reasons.push(`Weighted average ${r.avg_pct}% is close to or under the pass mark (${pass}%)`);
    r.needs_support = r.reasons.length > 0;
  });
  res.json({ course: req.course, students: rows });
}));

module.exports = router;
