// Integration tests run against the real UniversityDB (start MySQL first, then: npm run db:setup && npm run db:seed).
process.env.NODE_ENV = 'test';
const app = require('../server');
let server, base;
exports.start = () => new Promise((res) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); });
exports.stop = async () => { await new Promise((r) => server.close(r)); await require('../src/config/db').end(); };
exports.call = async (method, url, { token, body } = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: json };
};
exports.login = async (email, password) => (await exports.call('POST', '/api/auth/login', { body: { email, password } })).body.token;
exports.raw = (url, token) => fetch(base + url, { headers: { Authorization: 'Bearer ' + token } });
exports.upload = async (url, token, fd) => { const r = await fetch(base + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd }); let body = {}; try { body = await r.json(); } catch (e) { /* none */ } return { status: r.status, body }; };
