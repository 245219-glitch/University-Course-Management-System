const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { HttpError, wrap, notify, int, str } = require('../utils/helpers');

router.use(authenticate);

// ---------- Notifications ----------
router.get('/notifications', wrap(async (req, res) => {
  const [rows] = await db.execute('SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]);
  const [[u]] = await db.execute('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ notifications: rows, unread: u.n });
}));
router.put('/notifications/read-all', wrap(async (req, res) => {
  await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'All notifications marked as read.' });
}));
router.put('/notifications/:id/read', wrap(async (req, res) => {
  await db.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [int(req.params.id), req.user.id]);
  res.json({ message: 'Marked as read.' });
}));

// ---------- Announcements (scoped to the viewer) ----------
router.get('/announcements', wrap(async (req, res) => {
  const u = req.user; let where, p;
  if (u.role === 'student') { where = "(a.course_id IS NULL AND a.audience IN ('all','students')) OR a.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ? AND status = 'enrolled')"; p = [u.id]; }
  else if (u.role === 'faculty') { where = "(a.course_id IS NULL AND a.audience IN ('all','faculty')) OR a.course_id IN (SELECT id FROM courses WHERE instructor_id = ?)"; p = [u.id]; }
  else { where = '1=1'; p = []; }
  const [rows] = await db.execute(`SELECT a.id, a.title, a.message, a.created_at, c.code course_code, au.full_name author
    FROM announcements a LEFT JOIN courses c ON c.id = a.course_id LEFT JOIN users au ON au.id = a.author_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 50`, p);
  res.json({ announcements: rows });
}));

// ---------- Academic calendar ----------
router.get('/calendar', wrap(async (req, res) => {
  const [events] = await db.execute('SELECT id, title, event_date date, type, description FROM calendar_events ORDER BY event_date');
  const [sems] = await db.execute('SELECT name, start_date, end_date FROM semesters');
  sems.forEach((s) => { events.push({ title: `${s.name} begins`, date: s.start_date, type: 'semester' }, { title: `${s.name} ends`, date: s.end_date, type: 'semester' }); });
  if (req.user.role !== 'admin') {
    const sql = req.user.role === 'student'
      ? "SELECT a.title, DATE(a.due_date) date, c.code FROM assignments a JOIN courses c ON c.id = a.course_id JOIN enrollments e ON e.course_id = c.id AND e.student_id = ? AND e.status = 'enrolled'"
      : 'SELECT a.title, DATE(a.due_date) date, c.code FROM assignments a JOIN courses c ON c.id = a.course_id WHERE c.instructor_id = ?';
    const [as] = await db.execute(sql, [req.user.id]);
    as.forEach((a) => events.push({ title: `${a.code}: ${a.title} due`, date: a.date, type: 'deadline' }));
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ events });
}));

// ---------- Messaging (students <-> their instructors, faculty <-> their students, admins <-> anyone) ----------
async function allowedRecipients(u) {
  let rows;
  if (u.role === 'student') [rows] = await db.execute(
    `SELECT DISTINCT x.id, x.full_name, x.role FROM users x WHERE x.status = 'active' AND (x.role = 'admin' OR x.id IN
      (SELECT c.instructor_id FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.student_id = ? AND e.status = 'enrolled'))`, [u.id]);
  else if (u.role === 'faculty') [rows] = await db.execute(
    `SELECT DISTINCT x.id, x.full_name, x.role FROM users x WHERE x.status = 'active' AND (x.role = 'admin' OR x.id IN
      (SELECT e.student_id FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = ? AND e.status = 'enrolled'))`, [u.id]);
  else [rows] = await db.execute("SELECT id, full_name, role FROM users WHERE status = 'active' AND id <> ? ORDER BY full_name LIMIT 500", [u.id]);
  return rows;
}
router.get('/messages/recipients', wrap(async (req, res) => res.json({ recipients: await allowedRecipients(req.user) })));
router.get('/messages', wrap(async (req, res) => {
  const [inbox] = await db.execute('SELECT m.id, m.subject, m.body, m.is_read, m.created_at, u.full_name sender FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.recipient_id = ? ORDER BY m.id DESC LIMIT 100', [req.user.id]);
  const [sent] = await db.execute('SELECT m.id, m.subject, m.body, m.created_at, u.full_name recipient FROM messages m JOIN users u ON u.id = m.recipient_id WHERE m.sender_id = ? ORDER BY m.id DESC LIMIT 100', [req.user.id]);
  res.json({ inbox, sent });
}));
router.post('/messages', wrap(async (req, res) => {
  const rid = int(req.body.recipient_id), subject = str(req.body.subject, 150), body = str(req.body.body, 3000);
  if (!rid || subject.length < 2 || body.length < 2) throw new HttpError(400, 'Choose a recipient and write a subject and message.');
  if (!(await allowedRecipients(req.user)).some((r) => r.id === rid)) throw new HttpError(403, 'You can only message people connected to your courses.', 'FORBIDDEN');
  await db.execute('INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?,?,?,?)', [req.user.id, rid, subject, body]);
  await notify(rid, 'New message', `${req.user.full_name}: ${subject}`, 'info');
  res.status(201).json({ message: 'Message sent.' });
}));
router.put('/messages/:id/read', wrap(async (req, res) => {
  await db.execute('UPDATE messages SET is_read = 1 WHERE id = ? AND recipient_id = ?', [int(req.params.id), req.user.id]);
  res.json({ message: 'Marked as read.' });
}));

// ---------- Protected file downloads ----------
router.get('/files/:type/:id', wrap(async (req, res) => {
  const id = int(req.params.id), u = req.user; let row;
  if (req.params.type === 'materials') {
    [[row]] = await db.execute(
      `SELECT m.file_path, m.file_name, c.instructor_id, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = m.course_id AND e.student_id = ? AND e.status IN ('enrolled','completed')) member
         FROM materials m JOIN courses c ON c.id = m.course_id WHERE m.id = ?`, [u.id, id]);
    if (row && !(u.role === 'admin' || row.instructor_id === u.id || (u.role === 'student' && row.member))) row = 'deny';
  } else if (req.params.type === 'submissions') {
    [[row]] = await db.execute('SELECT s.file_path, s.file_name, s.student_id, c.instructor_id FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id WHERE s.id = ?', [id]);
    if (row && !(u.role === 'admin' || row.instructor_id === u.id || row.student_id === u.id)) row = 'deny';
  } else throw new HttpError(404, 'Unknown file type.');
  if (row === 'deny') throw new HttpError(403, 'You do not have access to this file.', 'FORBIDDEN');
  if (!row || !row.file_path) throw new HttpError(404, 'File not found.');
  const full = path.join(__dirname, '..', '..', 'uploads', req.params.type, path.basename(row.file_path));
  if (!fs.existsSync(full)) throw new HttpError(404, 'File is no longer on the server.');
  res.download(full, row.file_name);
}));

module.exports = router;
