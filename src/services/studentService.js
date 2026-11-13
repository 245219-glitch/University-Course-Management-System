const db = require('../config/db');
const { getSetting } = require('../utils/helpers');
const { overlaps, describe, DAYS, fmt } = require('../utils/schedule');

async function enrolledCourses(sid) {
  const [rows] = await db.execute(
    `SELECT c.id, c.code, c.title, c.credit_hours, c.description, u.full_name instructor_name, s.name semester_name
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN users u ON u.id = c.instructor_id LEFT JOIN semesters s ON s.id = c.semester_id
      WHERE e.student_id = ? AND e.status = 'enrolled' ORDER BY c.code`, [sid]);
  return rows;
}

async function timetable(sid) {
  const [rows] = await db.execute(
    `SELECT t.day_of_week, t.start_time, t.end_time, t.room, c.id course_id, c.code, c.title, u.full_name instructor_name
       FROM enrollments e JOIN timetables t ON t.course_id = e.course_id JOIN courses c ON c.id = e.course_id
       LEFT JOIN users u ON u.id = c.instructor_id
      WHERE e.student_id = ? AND e.status = 'enrolled' ORDER BY t.day_of_week, t.start_time`, [sid]);
  return rows;
}

async function pendingAssignments(sid) {
  const [rows] = await db.execute(
    `SELECT a.id, a.title, a.due_date, a.max_marks, c.code, c.title course_title
       FROM assignments a JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ? AND e.status = 'enrolled'
       JOIN courses c ON c.id = a.course_id
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
      WHERE s.id IS NULL AND a.due_date >= NOW() ORDER BY a.due_date`, [sid]);
  return rows;
}

async function attendanceSummary(sid) {
  const threshold = await getSetting('attendance_threshold', 75);
  const [rows] = await db.execute(
    `SELECT c.id course_id, c.code, c.title, COALESCE(SUM(a.status IN ('present','late')), 0) attended, COUNT(a.id) total
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN attendance a ON a.course_id = c.id AND a.student_id = e.student_id
      WHERE e.student_id = ? AND e.status = 'enrolled' GROUP BY c.id, c.code, c.title ORDER BY c.code`, [sid]);
  rows.forEach((r) => { r.percentage = r.total ? Math.round((r.attended / r.total) * 1000) / 10 : null; r.below_threshold = r.total > 0 && r.percentage < threshold; });
  const attended = rows.reduce((s, r) => s + r.attended, 0); const total = rows.reduce((s, r) => s + r.total, 0);
  return { threshold, courses: rows, overall: total ? Math.round((attended / total) * 1000) / 10 : null };
}

async function gpa(sid) {
  const [rows] = await db.execute(
    `SELECT s.name semester, COALESCE(SUM(e.grade_points * c.credit_hours), 0) pts, COALESCE(SUM(c.credit_hours), 0) credits
       FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN semesters s ON s.id = c.semester_id
      WHERE e.student_id = ? AND e.status = 'completed' GROUP BY s.id, s.name ORDER BY s.start_date`, [sid]);
  const totalPts = rows.reduce((a, r) => a + r.pts, 0); const totalCr = rows.reduce((a, r) => a + r.credits, 0);
  return {
    cgpa: totalCr ? Math.round((totalPts / totalCr) * 100) / 100 : 0,
    completed_credits: totalCr,
    semesters: rows.map((r) => ({ semester: r.semester || 'Unassigned', gpa: r.credits ? Math.round((r.pts / r.credits) * 100) / 100 : 0, credits: r.credits }))
  };
}

// Rule-based recommendation engine: open courses the student is actually eligible for, ranked.
async function recommendations(sid, departmentId, limit = 6) {
  const [courses] = await db.execute(
    `SELECT c.id, c.code, c.title, c.credit_hours, c.department_id, d.name department_name, u.full_name instructor_name,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'enrolled') enrolled,
            c.capacity, (SELECT COUNT(*) FROM course_prerequisites cp WHERE cp.prerequisite_id = c.id) unlocks
       FROM courses c LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN users u ON u.id = c.instructor_id
       LEFT JOIN semesters s ON s.id = c.semester_id
      WHERE c.status = 'open' AND (s.id IS NULL OR s.registration_open = 1)
        AND c.id NOT IN (SELECT course_id FROM enrollments WHERE student_id = ? AND status IN ('enrolled','completed'))
        AND c.id NOT IN (SELECT course_id FROM waitlists WHERE student_id = ?)`, [sid, sid]);
  const [done] = await db.execute("SELECT course_id FROM enrollments WHERE student_id = ? AND status = 'completed' AND grade_points > 0", [sid]);
  const doneIds = new Set(done.map((d) => d.course_id));
  const [pre] = await db.execute('SELECT course_id, prerequisite_id FROM course_prerequisites');
  const [mySlots] = await db.execute(`SELECT t.* FROM timetables t JOIN enrollments e ON e.course_id = t.course_id AND e.student_id = ? AND e.status = 'enrolled'`, [sid]);
  const [allSlots] = await db.execute('SELECT * FROM timetables');
  const maxCredits = await getSetting('max_credits', 18);
  const [[used]] = await db.execute("SELECT COALESCE(SUM(c.credit_hours),0) t FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND e.status = 'enrolled'", [sid]);

  const out = [];
  for (const c of courses) {
    if (c.enrolled >= c.capacity) continue;
    if (used.t + c.credit_hours > maxCredits) continue;
    if (pre.some((p) => p.course_id === c.id && !doneIds.has(p.prerequisite_id))) continue;
    const slots = allSlots.filter((s) => s.course_id === c.id);
    if (slots.some((a) => mySlots.some((b) => overlaps(a, b)))) continue;
    let score = 1; const reasons = [];
    if (departmentId && c.department_id === departmentId) { score += 3; reasons.push('Matches your department'); }
    if (pre.some((p) => p.course_id === c.id)) { score += 2; reasons.push('Builds on courses you completed'); }
    if (c.unlocks > 0) { score += 1; reasons.push(`Unlocks ${c.unlocks} advanced course${c.unlocks > 1 ? 's' : ''}`); }
    if (c.capacity - c.enrolled <= 5) reasons.push('Only a few seats left');
    if (!reasons.length) reasons.push('Fits your timetable and credit limit');
    out.push({ ...c, seats_left: c.capacity - c.enrolled, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}

// Simple rule-based assistant. It only ever reads the logged-in student's own data.
async function assistantAnswer(user, question) {
  const q = String(question || '').toLowerCase();
  if (/(which|what).*(course|subject).*(enrol|take|register)|can i (enrol|take|register)|recommend/.test(q)) {
    const recs = await recommendations(user.id, user.department_id, 4);
    return recs.length ? 'You are eligible for: ' + recs.map((r) => `${r.code} ${r.title} (${r.seats_left} seats)`).join('; ') + '.'
      : 'I could not find any open courses that fit your timetable, prerequisites and credit limit right now.';
  }
  if (/next class|next lecture|timetable|schedule|today/.test(q)) {
    const slots = await timetable(user.id);
    if (!slots.length) return 'You have no scheduled classes yet. Enrol in a course to see your timetable.';
    const now = new Date(); const day = now.getDay() === 0 ? 7 : now.getDay(); const mins = now.getHours() * 60 + now.getMinutes();
    const toM = (t) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
    const sorted = [...slots].sort((a, b) => ((a.day_of_week - day + 7) % 7) * 1440 + toM(a.start_time) - (((b.day_of_week - day + 7) % 7) * 1440 + toM(b.start_time)));
    const next = sorted.find((s) => s.day_of_week !== day || toM(s.start_time) > mins) || sorted[0];
    return `Your next class is ${next.code} ${next.title} on ${DAYS[next.day_of_week]} at ${fmt(next.start_time)}${next.room ? ' in ' + next.room : ''}.`;
  }
  if (/assignment|due|deadline|homework/.test(q)) {
    const list = await pendingAssignments(user.id);
    return list.length ? 'Pending assignments: ' + list.slice(0, 5).map((a) => `${a.code} "${a.title}" due ${a.due_date.slice(0, 16).replace('T', ' ')}`).join('; ') + '.' : 'You have no pending assignments. Nice work!';
  }
  if (/attendance|absent|present/.test(q)) {
    const a = await attendanceSummary(user.id);
    if (a.overall === null) return 'No attendance has been recorded for you yet.';
    const low = a.courses.filter((c) => c.below_threshold);
    return `Your overall attendance is ${a.overall}%.` + (low.length ? ` Below ${a.threshold}% in: ${low.map((c) => c.code + ' (' + c.percentage + '%)').join(', ')}.` : ` You are above the ${a.threshold}% requirement everywhere.`);
  }
  if (/gpa|cgpa|grade|result|credit/.test(q)) {
    const g = await gpa(user.id);
    return g.completed_credits ? `Your CGPA is ${g.cgpa} across ${g.completed_credits} completed credit hours.` : 'You have no completed courses with final grades yet, so there is no CGPA to show.';
  }
  return 'I can help with: which courses you can enrol in, your next class, assignments due, your attendance, and your GPA. Try asking one of those.';
}

module.exports = { enrolledCourses, timetable, pendingAssignments, attendanceSummary, gpa, recommendations, assistantAnswer, describe };
