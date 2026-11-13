const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const db = require('../src/config/db');
let ids = {}; const run = Date.now() % 100000; const email = (n) => `enr${n}.${Date.now()}@test.edu`;

async function newStudent(n) {
  const e = email(n); await h.call('POST', '/api/auth/register', { body: { full_name: 'Enrol Tester', email: e, password: 'Passw0rdX' } });
  return h.login(e, 'Passw0rdX');
}
// Temporary courses (codes XT-*) keep these tests independent of the demo data.
async function mkCourse(tag, { cap = 30, status = 'open', slots = [], pre = [] } = {}) {
  const code = `XT-${tag}${run}`;
  const [[f]] = await db.execute("SELECT id FROM users WHERE email = 'fahad@unisphere.edu'");
  const [r] = await db.execute('INSERT INTO courses (code, title, credit_hours, capacity, status, instructor_id) VALUES (?,?,?,?,?,?)', [code, 'Temp ' + tag, 3, cap, status, f.id]);
  for (const s of slots) await db.execute('INSERT INTO timetables (course_id, day_of_week, start_time, end_time, room) VALUES (?,?,?,?,?)', [r.insertId, ...s]);
  for (const p of pre) await db.execute('INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES (?,?)', [r.insertId, p]);
  ids[tag] = r.insertId; return code;
}
async function giveCredit(token, courseId) {
  const me = (await h.call('GET', '/api/auth/me', { token })).body.user;
  await db.execute("INSERT INTO enrollments (student_id, course_id, status, grade_letter, grade_points, final_percentage) VALUES (?,?,'completed','A',4,90)", [me.id, courseId]);
}
before(h.start);
after(async () => {
  await db.execute("DELETE FROM courses WHERE code LIKE 'XT-%'"); await db.execute("DELETE FROM users WHERE email LIKE 'enr%@test.edu'"); await h.stop();
});
const enrol = (t, tag) => h.call('POST', '/api/enrollments', { token: t, body: { course_id: ids[tag] } });

test('enrol succeeds, duplicate is blocked, withdrawal works, re-enrol works', async () => {
  await mkCourse('A'); const t = await newStudent(1);
  assert.strictEqual((await enrol(t, 'A')).status, 201);
  assert.strictEqual((await enrol(t, 'A')).status, 409);
  assert.strictEqual((await h.call('DELETE', `/api/enrollments/${ids.A}`, { token: t })).status, 200);
  assert.strictEqual((await enrol(t, 'A')).status, 201);
});
test('prerequisites are enforced (real seeded CS-101 prerequisite)', async () => {
  const [[cs101]] = await db.execute("SELECT id FROM courses WHERE code = 'CS-101'");
  await mkCourse('B', { pre: [cs101.id] }); const t = await newStudent(2);
  const r = await enrol(t, 'B'); assert.strictEqual(r.status, 422); assert.match(r.body.error, /CS-101/);
  await giveCredit(t, cs101.id); assert.strictEqual((await enrol(t, 'B')).status, 201);
});
test('timetable conflicts are detected', async () => {
  await mkCourse('C1', { slots: [[1, '08:00', '09:00', 'Z-1']] }); await mkCourse('C2', { slots: [[1, '08:30', '09:30', 'Z-2']] });
  const t = await newStudent(3); assert.strictEqual((await enrol(t, 'C1')).status, 201);
  const r = await enrol(t, 'C2'); assert.strictEqual(r.status, 409); assert.match(r.body.error, /conflict/i);
});
test('full course -> waiting list -> withdrawal promotes the first in line', async () => {
  await mkCourse('D', { cap: 3 }); const s = await Promise.all([4, 5, 6, 7].map(newStudent));
  for (const t of s.slice(0, 3)) assert.strictEqual((await enrol(t, 'D')).status, 201);
  const w = await enrol(s[3], 'D'); assert.strictEqual(w.status, 202); assert.strictEqual(w.body.waitlisted, true);
  await h.call('DELETE', `/api/enrollments/${ids.D}`, { token: s[0] });
  const mine = (await h.call('GET', '/api/enrollments/me', { token: s[3] })).body;
  assert.ok(mine.enrollments.some((e) => e.course_id === ids.D && e.status === 'enrolled'));
});
test('simultaneous requests for the last seat: exactly one wins', async () => {
  await mkCourse('E', { cap: 1 }); const s = await Promise.all([8, 9, 10, 11, 12].map(newStudent));
  const res = await Promise.all(s.map((t) => enrol(t, 'E')));
  assert.strictEqual(res.filter((r) => r.status === 201).length, 1);
  assert.strictEqual(res.filter((r) => r.status === 202).length, 4);
});
test('closed courses cannot be enrolled in', async () => {
  await mkCourse('F', { status: 'closed' }); const t = await newStudent(13);
  assert.strictEqual((await enrol(t, 'F')).status, 409);
});
test('credit limit is enforced', async () => {
  const t = await newStudent(14); await mkCourse('G1'); await db.execute("UPDATE settings SET v = '3' WHERE k = 'max_credits'");
  try { assert.strictEqual((await enrol(t, 'G1')).status, 201); await mkCourse('G2'); assert.strictEqual((await enrol(t, 'G2')).status, 422); }
  finally { await db.execute("UPDATE settings SET v = '18' WHERE k = 'max_credits'"); }
});
