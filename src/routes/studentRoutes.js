const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { HttpError, wrap, audit, notify, int, str } = require('../utils/helpers');
const svc = require('../services/studentService');

router.use(authenticate, authorize('student'));

router.get('/dashboard', wrap(async (req, res) => {
  const sid = req.user.id;
  const [courses, slots, pending, att, g] = await Promise.all([
    svc.enrolledCourses(sid), svc.timetable(sid), svc.pendingAssignments(sid), svc.attendanceSummary(sid), svc.gpa(sid)]);
  const [[unread]] = await db.execute('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', [sid]);
  const [[sem]] = await db.execute('SELECT name, start_date, end_date FROM semesters WHERE is_current = 1 LIMIT 1');
  const [[prof]] = await db.execute('SELECT u.id, u.full_name, u.email, u.reg_no, u.program, u.semester_no, u.created_at, d.name department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [sid]);
  const [[cr]] = await db.execute("SELECT COALESCE(SUM(c.credit_hours),0) t FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND e.status = 'enrolled'", [sid]);
  res.json({
    profile: prof, semester: sem || null,
    stats: { enrolled_courses: courses.length, current_credits: cr.t, completed_credits: g.completed_credits, cgpa: g.cgpa,
             pending_assignments: pending.length, attendance: att.overall, unread_notifications: unread.n },
    courses, timetable: slots, pending_assignments: pending.slice(0, 5), attendance: att
  });
}));

router.get('/timetable', wrap(async (req, res) => res.json({ timetable: await svc.timetable(req.user.id) })));
router.get('/attendance', wrap(async (req, res) => res.json(await svc.attendanceSummary(req.user.id))));
router.get('/recommendations', wrap(async (req, res) => res.json({ recommendations: await svc.recommendations(req.user.id, req.user.department_id) })));

router.get('/grades', wrap(async (req, res) => {
  const sid = req.user.id;
  const g = await svc.gpa(sid);
  const [comps] = await db.execute('SELECT * FROM grades WHERE student_id = ? ORDER BY created_at', [sid]);
  const [courses] = await db.execute(
    `SELECT c.id, c.code, c.title, c.credit_hours, e.status, e.grade_letter, e.grade_points, e.final_percentage
       FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND e.status IN ('enrolled','completed') ORDER BY e.status, c.code`, [sid]);
  courses.forEach((c) => {
    c.components = comps.filter((x) => x.course_id === c.id);
    const w = c.components.reduce((s, x) => s + x.weight, 0);
    c.percentage_so_far = w ? Math.round(c.components.reduce((s, x) => s + (x.marks / x.max_marks) * x.weight, 0) / w * 1000) / 10 : null;
  });
  res.json({ ...g, courses });
}));

router.get('/assignments', wrap(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT a.id, a.title, a.description, a.due_date, a.max_marks, c.id course_id, c.code, c.title course_title,
            s.id submission_id, s.status submission_status, s.submitted_at, s.marks, s.feedback, s.file_name, s.text_answer
       FROM assignments a JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ? AND e.status IN ('enrolled','completed')
       JOIN courses c ON c.id = a.course_id LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
      ORDER BY a.due_date DESC`, [req.user.id]);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  rows.forEach((r) => { r.status = r.submission_status || (r.due_date < now ? 'overdue' : 'pending'); });
  res.json({ assignments: rows });
}));

router.post('/assignments/:id/submit', upload.submissions.single('file'), wrap(async (req, res) => {
  const aid = int(req.params.id);
  const [[a]] = await db.execute(
    `SELECT a.id, a.title, a.due_date, c.code, c.instructor_id FROM assignments a JOIN courses c ON c.id = a.course_id
      JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ? AND e.status = 'enrolled' WHERE a.id = ?`, [req.user.id, aid]);
  if (!a) throw new HttpError(404, 'Assignment not found in your enrolled courses.');
  const text = str(req.body.text_answer, 5000);
  if (!req.file && !text) throw new HttpError(400, 'Attach a file or write an answer before submitting.');
  const [[old]] = await db.execute('SELECT status FROM submissions WHERE assignment_id = ? AND student_id = ?', [aid, req.user.id]);
  if (old && old.status === 'graded') throw new HttpError(409, 'This submission has already been graded.');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const status = a.due_date < now ? 'late' : 'submitted';
  await db.execute(
    `INSERT INTO submissions (assignment_id, student_id, text_answer, file_path, file_name, status) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE text_answer = VALUES(text_answer), file_path = COALESCE(VALUES(file_path), file_path),
       file_name = COALESCE(VALUES(file_name), file_name), status = VALUES(status), submitted_at = NOW()`,
    [aid, req.user.id, text || null, req.file ? req.file.filename : null, req.file ? req.file.originalname.slice(0, 255) : null, status]);
  await notify(a.instructor_id, 'New submission', `${req.user.full_name} submitted "${a.title}" (${a.code}).`, 'info');
  await audit(req.user.id, 'SUBMIT', `Assignment ${aid}`, req.ip);
  res.status(201).json({ message: status === 'late' ? 'Submitted (marked late).' : 'Assignment submitted.', status });
}));

router.get('/materials', wrap(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT m.id, m.title, m.file_name, m.uploaded_at, c.id course_id, c.code, c.title course_title
       FROM materials m JOIN courses c ON c.id = m.course_id
       JOIN enrollments e ON e.course_id = m.course_id AND e.student_id = ? AND e.status IN ('enrolled','completed')
      ORDER BY m.uploaded_at DESC`, [req.user.id]);
  res.json({ materials: rows });
}));

// Support helpdesk
router.get('/tickets', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT id, category, subject, message, status, response, created_at, updated_at FROM support_tickets WHERE student_id = ? ORDER BY created_at DESC', [req.user.id]);
  res.json({ tickets: rows });
}));
router.post('/tickets', wrap(async (req, res) => {
  const subject = str(req.body.subject, 150); const message = str(req.body.message, 2000);
  const category = ['registration', 'timetable', 'account', 'academic', 'other'].includes(req.body.category) ? req.body.category : 'other';
  if (subject.length < 3 || message.length < 10) throw new HttpError(400, 'Please add a subject and describe the problem (at least 10 characters).');
  const [r] = await db.execute('INSERT INTO support_tickets (student_id, category, subject, message) VALUES (?,?,?,?)', [req.user.id, category, subject, message]);
  const [admins] = await db.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  await notify(admins.map((a) => a.id), 'New support ticket', `${req.user.full_name}: ${subject}`, 'info');
  res.status(201).json({ message: 'Ticket submitted. We will reply here.', id: r.insertId });
}));

router.post('/assistant', wrap(async (req, res) => {
  const q = str(req.body.question, 300);
  if (!q) throw new HttpError(400, 'Please type a question.');
  res.json({ answer: await svc.assistantAnswer(req.user, q) });
}));

module.exports = router;
