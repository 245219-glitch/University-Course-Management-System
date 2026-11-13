const { test, before, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const h = require('./helpers');
before(h.start); after(h.stop);
const email = `t${Date.now()}@test.edu`;

test('register with valid info creates a student (role in body is ignored)', async () => {
  const r = await h.call('POST', '/api/auth/register', { body: { full_name: 'Test User', email, password: 'Passw0rdX', role: 'admin' } });
  assert.strictEqual(r.status, 201);
  const token = await h.login(email, 'Passw0rdX');
  assert.strictEqual((await h.call('GET', '/api/auth/me', { token })).body.user.role, 'student');
});
test('duplicate email is rejected', async () => assert.strictEqual((await h.call('POST', '/api/auth/register', { body: { full_name: 'Test User', email, password: 'Passw0rdX' } })).status, 409));
test('invalid email / short password / empty name are rejected', async () => {
  for (const b of [{ full_name: 'Abc', email: 'nope', password: 'Passw0rdX' }, { full_name: 'Abc', email: 'a@b.edu', password: 'short1' }, { full_name: '', email: 'a@b.edu', password: 'Passw0rdX' }])
    assert.strictEqual((await h.call('POST', '/api/auth/register', { body: b })).status, 400);
});
test('login with wrong password and unknown user gives 401', async () => {
  assert.strictEqual((await h.call('POST', '/api/auth/login', { body: { email, password: 'wrong' } })).status, 401);
  assert.strictEqual((await h.call('POST', '/api/auth/login', { body: { email: 'ghost@x.edu', password: 'whatever1' } })).status, 401);
});
test('stored password is a bcrypt hash, never plain text', async () => {
  const db = require('../src/config/db'); const [[u]] = await db.execute('SELECT password_hash FROM users WHERE email = ?', [email]);
  assert.match(u.password_hash, /^\$2[aby]\$/); assert.notStrictEqual(u.password_hash, 'Passw0rdX');
});
test('missing, invalid and expired tokens return 401', async () => {
  assert.strictEqual((await h.call('GET', '/api/courses')).body.code, 'MISSING_TOKEN');
  assert.strictEqual((await h.call('GET', '/api/courses', { token: 'garbage' })).body.code, 'INVALID_TOKEN');
  const expired = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET || 'dev-only-secret-change-me', { expiresIn: -10, issuer: 'unisphere' });
  const r = await h.call('GET', '/api/courses', { token: expired });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'TOKEN_EXPIRED');
});
test('each portal login only accepts its own role', async () => {
  const L = (e, p, role) => h.call('POST', '/api/auth/login', { body: { email: e, password: p, role } });
  assert.strictEqual((await L('tehreem@unisphere.edu', 'Student@123', 'student')).status, 200);
  assert.strictEqual((await L('fahad@unisphere.edu', 'Faculty@123', 'faculty')).status, 200);
  assert.strictEqual((await L('coco@unisphere.edu', 'Admin@12345', 'admin')).status, 200);
  const wrong = await L('tehreem@unisphere.edu', 'Student@123', 'admin');          // student trying the admin tab
  assert.strictEqual(wrong.status, 403); assert.strictEqual(wrong.body.code, 'WRONG_PORTAL');
  assert.strictEqual((await L('coco@unisphere.edu', 'Admin@12345', 'faculty')).status, 403);
  assert.strictEqual((await L('fahad@unisphere.edu', 'wrong-pass', 'faculty')).status, 401);
});
