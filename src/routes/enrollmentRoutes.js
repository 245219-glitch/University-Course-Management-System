const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { HttpError, wrap, audit, notify, getSetting, int } = require('../utils/helpers');
const { findStudentConflict } = require('../utils/schedule');

router.use(authenticate, authorize('student'));

// Enrol: runs inside a transaction with a row lock on the course so two students can never take the last seat.
router.post('/', wrap(async (req, res) => {
  const courseId = int(req.body.course_id);
  if (!courseId) throw new HttpError(400, 'course_id is required.');
  const sid = req.user.id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[course]] = await conn.execute('SELECT * FROM courses WHERE id = ? FOR UPDATE', [courseId]);
    if (!course) throw new HttpError(404, 'Course not found.');
    if (course.status !== 'open') throw new HttpError(409, 'Registration for this course is closed.');
    if (course.semester_id) {
      const [[sem]] = await conn.execute('SELECT registration_open FROM semesters WHERE id = ?', [course.semester_id]);
      if (sem && !sem.registration_open) throw new HttpError(409, 'Registration for this semester is closed.');
    }
    const [[existing]] = await conn.execute('SELECT id, status FROM enrollments WHERE student_id = ? AND course_id = ?', [sid, courseId]);
    if (existing && existing.status === 'enrolled') throw new HttpError(409, 'You are already enrolled in this course.');
    if (existing && existing.status === 'completed') throw new HttpError(409, 'You have already completed this course.');
    const [[wl]] = await conn.execute('SELECT id FROM waitlists WHERE student_id = ? AND course_id = ?', [sid, courseId]);
    if (wl) throw new HttpError(409, 'You are already on the waiting list for this course.');

    const [prereqs] = await conn.execute('SELECT c.id, c.code FROM course_prerequisites p JOIN courses c ON c.id = p.prerequisite_id WHERE p.course_id = ?', [courseId]);
    if (prereqs.length) {
      const [done] = await conn.execute("SELECT course_id FROM enrollments WHERE student_id = ? AND status = 'completed' AND grade_points > 0", [sid]);
      const doneIds = new Set(done.map((d) => d.course_id));
      const missing = prereqs.filter((p) => !doneIds.has(p.id)).map((p) => p.code);
      if (missing.length) throw new HttpError(422, `Prerequisites not met. Complete first: ${missing.join(', ')}.`);
    }

    const maxCredits = await getSetting('max_credits', 18, conn);
    const [[cr]] = await conn.execute(
      `SELECT COALESCE(SUM(c.credit_hours), 0) total FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = ? AND e.status = 'enrolled' AND c.semester_id <=> ?`, [sid, course.semester_id]);
    if (cr.total + course.credit_hours > maxCredits)
      throw new HttpError(422, `Credit limit exceeded: you have ${cr.total} credit hours and the maximum is ${maxCredits}.`);

    const conflict = await findStudentConflict(conn, sid, courseId);
    if (conflict) throw new HttpError(409, `Timetable conflict with ${conflict.code} (${conflict.slot}).`);

    const [[cnt]] = await conn.execute("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'enrolled'", [courseId]);
    if (cnt.n >= course.capacity) {
      await conn.execute('INSERT INTO waitlists (student_id, course_id) VALUES (?, ?)', [sid, courseId]);
      const [[pos]] = await conn.execute('SELECT COUNT(*) n FROM waitlists WHERE course_id = ?', [courseId]);
      await notify(sid, 'Added to waiting list', `${course.code} is full. You are number ${pos.n} on the waiting list.`, 'warning', conn);
      await conn.commit();
      return res.status(202).json({ waitlisted: true, position: pos.n, message: `This course is full. You are number ${pos.n} on the waiting list.` });
    }
    if (existing) await conn.execute("UPDATE enrollments SET status = 'enrolled', grade_letter = NULL, grade_points = NULL, final_percentage = NULL WHERE id = ?", [existing.id]);
    else await conn.execute('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)', [sid, courseId]);
    await notify(sid, 'Enrolment confirmed', `You are now enrolled in ${course.code} - ${course.title}.`, 'success', conn);
    await audit(sid, 'ENROL', course.code, req.ip, conn);
    await conn.commit();
    res.status(201).json({ message: `Enrolled in ${course.code} successfully.` });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// Withdraw, then automatically give the freed seat to the first eligible student on the waiting list.
router.delete('/:courseId', wrap(async (req, res) => {
  const courseId = int(req.params.courseId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[course]] = await conn.execute('SELECT id, code, capacity FROM courses WHERE id = ? FOR UPDATE', [courseId]);
    if (!course) throw new HttpError(404, 'Course not found.');
    const [r] = await conn.execute("UPDATE enrollments SET status = 'withdrawn' WHERE student_id = ? AND course_id = ? AND status = 'enrolled'", [req.user.id, courseId]);
    if (!r.affectedRows) throw new HttpError(404, 'You are not currently enrolled in this course.');
    await audit(req.user.id, 'WITHDRAW', course.code, req.ip, conn);

    const [queue] = await conn.execute('SELECT id, student_id FROM waitlists WHERE course_id = ? ORDER BY id', [courseId]);
    for (const w of queue) {
      const [[cnt]] = await conn.execute("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'enrolled'", [courseId]);
      if (cnt.n >= course.capacity) break;
      if (await findStudentConflict(conn, w.student_id, courseId)) continue;
      const [[old]] = await conn.execute('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?', [w.student_id, courseId]);
      if (old) await conn.execute("UPDATE enrollments SET status = 'enrolled' WHERE id = ?", [old.id]);
      else await conn.execute('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)', [w.student_id, courseId]);
      await conn.execute('DELETE FROM waitlists WHERE id = ?', [w.id]);
      await notify(w.student_id, 'A seat opened up', `You were moved from the waiting list into ${course.code}.`, 'success', conn);
      await audit(w.student_id, 'WAITLIST_PROMOTE', course.code, req.ip, conn);
    }
    await conn.commit();
    res.json({ message: `You have withdrawn from ${course.code}.` });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

router.delete('/waitlist/:courseId', wrap(async (req, res) => {
  const [r] = await db.execute('DELETE FROM waitlists WHERE student_id = ? AND course_id = ?', [req.user.id, int(req.params.courseId)]);
  if (!r.affectedRows) throw new HttpError(404, 'You are not on this waiting list.');
  res.json({ message: 'Removed from the waiting list.' });
}));

// Enrolment history (all statuses) + current waiting list
router.get('/me', wrap(async (req, res) => {
  const [enrollments] = await db.execute(
    `SELECT e.id, e.status, e.grade_letter, e.grade_points, e.final_percentage, e.enrolled_at, e.updated_at,
            c.id course_id, c.code, c.title, c.credit_hours, u.full_name instructor_name, s.name semester_name
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN users u ON u.id = c.instructor_id LEFT JOIN semesters s ON s.id = c.semester_id
      WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`, [req.user.id]);
  const [waitlist] = await db.execute(
    `SELECT w.course_id, c.code, c.title, w.created_at,
            (SELECT COUNT(*) FROM waitlists w2 WHERE w2.course_id = w.course_id AND w2.id <= w.id) position
       FROM waitlists w JOIN courses c ON c.id = w.course_id WHERE w.student_id = ?`, [req.user.id]);
  res.json({ enrollments, waitlist });
}));

module.exports = router;
