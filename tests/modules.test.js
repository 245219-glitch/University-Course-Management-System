const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const db = require('../src/config/db');
let S, F, A, base, cs201, sid;
const tag = Date.now();
before(async () => {
  await h.start(); S = await h.login('tehreem@unisphere.edu', 'Student@123'); F = await h.login('kamran@unisphere.edu', 'Faculty@123'); A = await h.login('coco@unisphere.edu', 'Admin@12345');
  cs201 = (await h.call('GET', '/api/courses?search=CS-201', { token: A })).body.courses[0].id;
  sid = (await h.call('GET', '/api/auth/me', { token: S })).body.user.id;
});
after(h.stop);
const ok = async (m, u, o) => { const r = await h.call(m, u, o); assert.ok(r.status < 300, `${m} ${u} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

test('student dashboard, timetable, attendance, grades, assignments, recommendations', async () => {
  const d = await ok('GET', '/api/student/dashboard', { token: S }); assert.ok(d.stats.enrolled_courses >= 1); assert.strictEqual(d.profile.email, 'tehreem@unisphere.edu'); assert.strictEqual(d.profile.program, 'BSCS');
  assert.ok((await ok('GET', '/api/student/timetable', { token: S })).timetable.length > 0);
  assert.ok((await ok('GET', '/api/student/attendance', { token: S })).courses.length > 0);
  assert.ok((await ok('GET', '/api/student/grades', { token: S })).cgpa > 0);
  assert.ok((await ok('GET', '/api/student/assignments', { token: S })).assignments.length > 0);
  await ok('GET', '/api/student/recommendations', { token: S });
  assert.match((await ok('POST', '/api/student/assistant', { token: S, body: { question: 'How is my attendance?' } })).answer, /attendance/i);
});
test('student support ticket + messaging + notifications + calendar + announcements', async () => {
  await ok('POST', '/api/student/tickets', { token: S, body: { category: 'account', subject: 'Test ticket ' + tag, message: 'This is a test ticket message.' } });
  const rc = await ok('GET', '/api/messages/recipients', { token: S }); assert.ok(rc.recipients.length > 0);
  await ok('POST', '/api/messages', { token: S, body: { recipient_id: rc.recipients[0].id, subject: 'Hello', body: 'Test message' } });
  const other = (await h.call('GET', '/api/admin/users?role=student&search=Hania', { token: A })).body.users[0].id;
  assert.strictEqual((await h.call('POST', '/api/messages', { token: S, body: { recipient_id: other, subject: 'Hi', body: 'Not allowed' } })).status, 403);
  await ok('GET', '/api/notifications', { token: S }); await ok('GET', '/api/calendar', { token: S }); await ok('GET', '/api/announcements', { token: S });
});
test('faculty: dashboard, attendance, assignment, grading, materials upload/download, final grade', async () => {
  assert.ok((await ok('GET', '/api/faculty/dashboard', { token: F })).courses.length >= 1);
  const st = (await ok('GET', `/api/faculty/courses/${cs201}/students`, { token: F })).students; assert.ok(st.length >= 3);
  const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await ok('POST', `/api/faculty/courses/${cs201}/attendance`, { token: F, body: { date, records: st.map((s) => ({ student_id: s.id, status: 'present' })) } });
  assert.strictEqual((await h.call('POST', `/api/faculty/courses/${cs201}/attendance`, { token: F, body: { date: '2999-01-01', records: [{ student_id: st[0].id, status: 'present' }] } })).status, 400);
  const a = await ok('POST', `/api/faculty/courses/${cs201}/assignments`, { token: F, body: { title: 'Test HW ' + tag, description: 'x', due_date: '2027-01-01T10:00', max_marks: 10 } });
  // student submits with a file
  const fd = new FormData(); fd.append('text_answer', 'my answer'); fd.append('file', new Blob(['hello pdf']), 'answer.pdf');
  const r = await h.upload(`/api/student/assignments/${a.id}/submit`, S, fd); assert.strictEqual(r.status, 201);
  const subs = await ok('GET', `/api/faculty/assignments/${a.id}/submissions`, { token: F }); assert.strictEqual(subs.submissions.length, 1);
  await ok('PUT', `/api/faculty/submissions/${subs.submissions[0].id}/grade`, { token: F, body: { marks: 8, feedback: 'Nice' } });
  assert.strictEqual((await h.call('PUT', `/api/faculty/submissions/${subs.submissions[0].id}/grade`, { token: F, body: { marks: 99 } })).status, 400);
  const dl = await h.raw(`/api/files/submissions/${subs.submissions[0].id}`, S); assert.strictEqual(dl.status, 200); assert.strictEqual(await dl.text(), 'hello pdf');
  const other = await h.login('hania@unisphere.edu', 'Student@123'); assert.strictEqual((await h.raw(`/api/files/submissions/${subs.submissions[0].id}`, other)).status, 403);
  const mf = new FormData(); mf.append('title', 'Slides'); mf.append('file', new Blob(['slides']), 'week1.pdf'); assert.strictEqual((await h.upload(`/api/faculty/courses/${cs201}/materials`, F, mf)).status, 201);
  const bad = new FormData(); bad.append('file', new Blob(['x']), 'virus.exe'); assert.strictEqual((await h.upload(`/api/faculty/courses/${cs201}/materials`, F, bad)).status, 400);
  assert.ok((await ok('GET', '/api/student/materials', { token: S })).materials.length >= 1);
  const fe = `fin${tag}@test.edu`; await h.call('POST', '/api/auth/register', { body: { full_name: 'Final Tester', email: fe, password: 'Passw0rdX' } });
  const [[fu]] = await db.execute('SELECT id FROM users WHERE email = ?', [fe]); await db.execute('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)', [fu.id, cs201]);
  await ok('POST', `/api/faculty/courses/${cs201}/grades`, { token: F, body: { student_id: fu.id, component: 'final', title: 'Final', marks: 90, max_marks: 100, weight: 60 } });
  const fin = await ok('POST', `/api/faculty/courses/${cs201}/final-grade`, { token: F, body: { student_id: fu.id } }); assert.strictEqual(fin.letter, 'A');
  await db.execute('DELETE FROM users WHERE id = ?', [fu.id]);
  await ok('GET', `/api/faculty/courses/${cs201}/report`, { token: F });
  await ok('POST', `/api/faculty/courses/${cs201}/announcements`, { token: F, body: { title: 'Test notice', message: 'Class moved to lab' } });
});
test('admin: stats, users, departments, semesters, announcements, tickets, audit, reports, settings, generator', async () => {
  assert.ok((await ok('GET', '/api/admin/stats', { token: A })).totals.students > 0);
  const email = `fac${tag}@test.edu`; const u = await ok('POST', '/api/admin/users', { token: A, body: { full_name: 'Temp Faculty', email, password: 'Passw0rdX', role: 'faculty' } });
  await ok('PUT', `/api/admin/users/${u.id}`, { token: A, body: { full_name: 'Temp Faculty', role: 'faculty', status: 'suspended' } });
  assert.strictEqual((await h.call('POST', '/api/auth/login', { body: { email, password: 'Passw0rdX' } })).status, 403);   // suspended
  const me = (await h.call('GET', '/api/auth/me', { token: A })).body.user;
  assert.strictEqual((await h.call('PUT', `/api/admin/users/${me.id}`, { token: A, body: { full_name: me.full_name, role: 'student', status: 'active' } })).status, 400);
  await ok('POST', '/api/admin/departments', { token: A, body: { name: 'Test Dept ' + tag, code: 'T' + (tag % 1000) } });
  await ok('POST', '/api/admin/announcements', { token: A, body: { title: 'Admin notice', message: 'Hello everyone', audience: 'all' } });
  const tk = (await ok('GET', '/api/admin/tickets', { token: A })).tickets; await ok('PUT', `/api/admin/tickets/${tk[0].id}`, { token: A, body: { status: 'resolved', response: 'Fixed' } });
  assert.ok((await ok('GET', '/api/admin/audit-logs', { token: A })).logs.length > 0);
  await ok('PUT', '/api/admin/settings', { token: A, body: { max_credits: 18, attendance_threshold: 75 } });
  assert.strictEqual((await h.call('PUT', '/api/admin/settings', { token: A, body: { max_credits: 999 } })).status, 400);
  const csv = await h.raw('/api/admin/reports/enrolments', A); assert.match(await csv.text(), /code,title/);
  const { body: sem } = await h.call('POST', '/api/admin/semesters', { token: A, body: { name: 'Gen ' + tag, start_date: '2027-02-01', end_date: '2027-06-01', registration_open: true } });
  const sems = (await ok('GET', '/api/admin/semesters', { token: A })).semesters; const sId = sems.find((s) => s.name === 'Gen ' + tag).id;
  const mk = (code) => h.call('POST', '/api/courses', { token: A, body: { code, title: 'Gen course ' + code, credit_hours: 3, capacity: 30, semester_id: sId, department_id: null } });
  await mk('GEN-1' + (tag % 100)); await mk('GEN-2' + (tag % 100));
  const g = await ok('POST', '/api/admin/timetable/generate', { token: A, body: { semester_id: sId } }); assert.strictEqual(g.placed.length, 2); assert.strictEqual(g.failed.length, 0);
  const [rows] = await db.execute('SELECT t.* FROM timetables t JOIN courses c ON c.id=t.course_id WHERE c.semester_id=?', [sId]); assert.strictEqual(rows.length, 4);
});
