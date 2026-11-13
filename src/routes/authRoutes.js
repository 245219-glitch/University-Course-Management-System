const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../config/db');
const { authenticate, signToken } = require('../middleware/auth');
const { HttpError, wrap, audit, int, str, isEmail, passwordProblem } = require('../utils/helpers');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts. Please try again in a few minutes.', code: 'RATE_LIMITED' }
});

// Public registration. A "role" sent by the client is ignored - everyone becomes a student.
router.post('/register', wrap(async (req, res) => {
  const full_name = str(req.body.full_name, 100);
  const email = str(req.body.email, 150).toLowerCase();
  const password = req.body.password;
  if (full_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
  if (!/^[\p{L}][\p{L} .'\-]*$/u.test(full_name)) throw new HttpError(400, 'Full name can only contain letters, spaces, dots, hyphens and apostrophes.');
  if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);

  const [dupe] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (dupe.length) throw new HttpError(409, 'An account with this email already exists.');

  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.execute(
    "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'student')", [full_name, email, hash]);
  await audit(r.insertId, 'REGISTER', `Student registered: ${email}`, req.ip);
  res.status(201).json({ message: 'Account created successfully. You can now log in.' });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) throw new HttpError(400, 'Email and password are required.');
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, u.status, u.department_id, u.program, u.semester_no, d.name department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.email = ?`, [email]);
  const u = rows[0];
  const ok = u ? await bcrypt.compare(password, u.password_hash) : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid.');
  if (!u || !ok) { await audit(u && u.id, 'LOGIN_FAILED', `Failed login for ${email}`, req.ip); throw new HttpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS'); }
  if (u.status !== 'active') throw new HttpError(403, 'This account has been suspended. Contact the administrator.', 'ACCOUNT_SUSPENDED');
  // Each portal login only accepts its own role (student / faculty / admin)
  const portal = ['student', 'faculty', 'admin'].includes(req.body.role) ? req.body.role : null;
  if (portal && portal !== u.role) {
    const label = { student: 'a student', faculty: 'a teacher', admin: 'an administrator' }[u.role];
    throw new HttpError(403, `This account is ${label} account. Please use the ${u.role === 'faculty' ? 'Teacher' : u.role[0].toUpperCase() + u.role.slice(1)} login tab.`, 'WRONG_PORTAL');
  }
  await db.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [u.id]);
  await audit(u.id, 'LOGIN', 'User logged in', req.ip);
  res.json({
    token: signToken(u),
    user: { id: u.id, full_name: u.full_name, email: u.email, role: u.role, department_name: u.department_name, program: u.program, semester_no: u.semester_no }
  });
}));

router.get('/me', authenticate, wrap(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.role, u.status, u.reg_no, u.program, u.semester_no, u.phone, u.bio, u.created_at, u.last_login,
            u.department_id, d.name department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, [req.user.id]);
  res.json({ user: rows[0] });
}));

router.put('/profile', authenticate, wrap(async (req, res) => {
  const full_name = str(req.body.full_name, 100);
  if (full_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
  await db.execute('UPDATE users SET full_name = ?, phone = ?, bio = ? WHERE id = ?',
    [full_name, str(req.body.phone, 30) || null, str(req.body.bio, 500) || null, req.user.id]);
  res.json({ message: 'Profile updated.' });
}));

router.post('/change-password', authenticate, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  const [rows] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (typeof current_password !== 'string' || !(await bcrypt.compare(current_password, rows[0].password_hash)))
    throw new HttpError(400, 'Your current password is incorrect.');
  const problem = passwordProblem(new_password);
  if (problem) throw new HttpError(400, problem);
  await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(new_password, 10), req.user.id]);
  await audit(req.user.id, 'PASSWORD_CHANGE', 'User changed password', req.ip);
  res.json({ message: 'Password changed successfully.' });
}));

module.exports = router;
