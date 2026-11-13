// Usage: node scripts/createAdmin.js "Full Name" email@uni.edu Password123
require('dotenv').config();
const bcrypt = require('bcryptjs'); const db = require('../src/config/db');
(async () => {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) { console.log('Usage: node scripts/createAdmin.js "Full Name" email password'); process.exit(1); }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { console.log('Password needs 8+ characters with a letter and a number.'); process.exit(1); }
  await db.execute("INSERT INTO users (full_name, email, password_hash, role) VALUES (?,?,?, 'admin')", [name, email.toLowerCase(), await bcrypt.hash(password, 10)]);
  console.log(`Admin created: ${email}`); await db.end();
})().catch((e) => { console.error(e.code === 'ER_DUP_ENTRY' ? 'That email already exists.' : e.message); process.exit(1); });
