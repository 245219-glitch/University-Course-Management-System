const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toMin = (t) => { const [h, m] = String(t).split(':'); return parseInt(h, 10) * 60 + parseInt(m, 10); };
const fmt = (t) => String(t).slice(0, 5);
const overlaps = (a, b) =>
  Number(a.day_of_week) === Number(b.day_of_week) && toMin(a.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(a.end_time);
const describe = (s) => `${DAYS[s.day_of_week]} ${fmt(s.start_time)}-${fmt(s.end_time)}`;

// Returns {code, slot} for the first timetable clash between a student's enrolled courses and the target course.
async function findStudentConflict(conn, studentId, courseId) {
  const [mine] = await conn.execute(
    `SELECT t.day_of_week, t.start_time, t.end_time, c.code
       FROM enrollments e JOIN timetables t ON t.course_id = e.course_id
       JOIN courses c ON c.id = e.course_id
      WHERE e.student_id = ? AND e.status = 'enrolled' AND e.course_id <> ?`, [studentId, courseId]);
  const [target] = await conn.execute(
    'SELECT day_of_week, start_time, end_time FROM timetables WHERE course_id = ?', [courseId]);
  for (const a of target) for (const b of mine) if (overlaps(a, b)) return { code: b.code, slot: describe(b) };
  return null;
}

module.exports = { DAYS, toMin, fmt, overlaps, describe, findStudentConflict };
