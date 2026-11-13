const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let admin, student, id; const code = 'TST-' + (Date.now() % 100000);
before(async () => { await h.start(); admin = await h.login('coco@unisphere.edu', 'Admin@12345'); student = await h.login('tehreem@unisphere.edu', 'Student@123'); });
after(h.stop);
const valid = () => ({ code, title: 'Test Course', description: 'd', credit_hours: 3, capacity: 20 });

test('admin creates, views, updates and deletes a course', async () => {
  const c = await h.call('POST', '/api/courses', { token: admin, body: valid() });
  assert.strictEqual(c.status, 201); id = c.body.id;
  assert.strictEqual((await h.call('GET', `/api/courses/${id}`, { token: student })).body.course.code, code);
  assert.strictEqual((await h.call('PUT', `/api/courses/${id}`, { token: admin, body: { ...valid(), title: 'Renamed', capacity: 25 } })).status, 200);
  assert.strictEqual((await h.call('GET', `/api/courses/${id}`, { token: admin })).body.course.title, 'Renamed');
  assert.strictEqual((await h.call('DELETE', `/api/courses/${id}`, { token: admin })).status, 200);
  assert.strictEqual((await h.call('GET', `/api/courses/${id}`, { token: admin })).status, 404);
});
test('duplicate code, invalid credits, empty fields and bad capacity are rejected', async () => {
  const a = await h.call('POST', '/api/courses', { token: admin, body: valid() }); id = a.body.id;
  assert.strictEqual((await h.call('POST', '/api/courses', { token: admin, body: valid() })).status, 409);
  for (const bad of [{ credit_hours: 9 }, { credit_hours: 0 }, { title: '' }, { code: '' }, { capacity: 0 }])
    assert.strictEqual((await h.call('POST', '/api/courses', { token: admin, body: { ...valid(), code: 'ZZ-9', ...bad } })).status, 400);
  await h.call('DELETE', `/api/courses/${id}`, { token: admin });
});
test('search and department filter work', async () => {
  const r = await h.call('GET', '/api/courses?search=Data', { token: student });
  assert.ok(r.body.courses.some((c) => c.code === 'CS-201'));
});
