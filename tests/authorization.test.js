const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let student, faculty, admin;
before(async () => { await h.start(); student = await h.login('tehreem@unisphere.edu', 'Student@123'); faculty = await h.login('fahad@unisphere.edu', 'Faculty@123'); admin = await h.login('coco@unisphere.edu', 'Admin@12345'); });
after(h.stop);

test('student cannot use admin APIs (403)', async () => {
  assert.strictEqual((await h.call('GET', '/api/admin/stats', { token: student })).status, 403);
  assert.strictEqual((await h.call('GET', '/api/admin/users', { token: student })).status, 403);
  assert.strictEqual((await h.call('POST', '/api/courses', { token: student, body: { code: 'HK-1', title: 'Hack', credit_hours: 3, capacity: 10 } })).status, 403);
  assert.strictEqual((await h.call('DELETE', '/api/courses/1', { token: student })).status, 403);
});
test('admin can open admin APIs', async () => assert.strictEqual((await h.call('GET', '/api/admin/stats', { token: admin })).status, 200));
test('admin APIs without token return 401', async () => assert.strictEqual((await h.call('GET', '/api/admin/stats')).status, 401));
test('faculty cannot reach admin or student-only APIs', async () => {
  assert.strictEqual((await h.call('GET', '/api/admin/stats', { token: faculty })).status, 403);
  assert.strictEqual((await h.call('GET', '/api/student/dashboard', { token: faculty })).status, 403);
});
test('faculty cannot modify a course assigned to someone else', async () => {
  const { body } = await h.call('GET', '/api/courses?search=CS-201', { token: admin });  // taught by Sir Kamran, so Sir Fahad is blocked
  const id = body.courses[0].id;
  assert.strictEqual((await h.call('GET', `/api/faculty/courses/${id}/students`, { token: faculty })).status, 403);
  assert.strictEqual((await h.call('POST', `/api/faculty/courses/${id}/announcements`, { token: faculty, body: { title: 'x y z', message: 'hello there' } })).status, 403);
});
test('student cannot grant themselves admin via profile or user APIs', async () => {
  assert.strictEqual((await h.call('PUT', '/api/admin/users/1', { token: student, body: { role: 'admin' } })).status, 403);
});
