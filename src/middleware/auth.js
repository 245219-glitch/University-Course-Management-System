const jwt = require('jsonwebtoken');
const db = require('../config/db');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('[UniSphere] JWT_SECRET is not set - using an insecure development secret.');

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '2h', issuer: 'unisphere' });

// Authentication: verifies the JWT on every protected request and loads the live user record.
async function authenticate(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token)
      return res.status(401).json({ error: 'Authentication required. Please log in.', code: 'MISSING_TOKEN' });
    let payload;
    try { payload = jwt.verify(token, SECRET, { issuer: 'unisphere' }); }
    catch (e) {
      if (e.name === 'TokenExpiredError')
        return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'TOKEN_EXPIRED' });
      return res.status(401).json({ error: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    }
    const [rows] = await db.execute(
      'SELECT id, full_name, email, role, status, department_id FROM users WHERE id = ?', [payload.id]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    if (rows[0].status !== 'active')
      return res.status(403).json({ error: 'This account has been suspended. Contact the administrator.', code: 'ACCOUNT_SUSPENDED' });
    req.user = rows[0];   // role always comes from the database, never from client-supplied data
    next();
  } catch (e) { next(e); }
}

// Authorization: role-based access control.
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role))
    return res.status(403).json({ error: 'You do not have permission to perform this action.', code: 'FORBIDDEN' });
  next();
};

module.exports = { authenticate, authorize, signToken };
