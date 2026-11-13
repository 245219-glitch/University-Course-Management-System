const db = require('../config/db');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function audit(userId, action, details, ip, conn = db) {
  try {
    await conn.execute('INSERT INTO audit_logs (user_id, action, details, ip) VALUES (?, ?, ?, ?)',
      [userId || null, action, String(details || '').slice(0, 500), ip || null]);
  } catch (e) { console.error('audit failed:', e.message); }
}

async function notify(userIds, title, message, type = 'info', conn = db) {
  const ids = [...new Set([].concat(userIds || []))].filter(Boolean);
  if (!ids.length) return;
  const rows = ids.map((id) => [id, String(title).slice(0, 150), String(message).slice(0, 500), type]);
  await conn.query('INSERT INTO notifications (user_id, title, message, type) VALUES ?', [rows]);
}

async function getSetting(key, fallback, conn = db) {
  const [rows] = await conn.execute('SELECT v FROM settings WHERE k = ?', [key]);
  return rows.length ? Number(rows[0].v) : fallback;
}

const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (e) => typeof e === 'string' && e.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters long.';
  if (p.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;          // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(',')].concat(rows.map((r) => columns.map((c) => esc(r[c])).join(','))).join('\n');
}

module.exports = { HttpError, wrap, audit, notify, getSetting, int, str, isEmail, passwordProblem, toCsv };
