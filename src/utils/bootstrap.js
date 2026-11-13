// Runs when the server starts: makes sure the database, tables and demo data exist,
// so a fresh or half-set-up database never ends in "Invalid email or password".
const { setupDb } = require('../../scripts/setupDb');
const { seedDemo, demoIsComplete } = require('../../scripts/seed');
const db = require('../config/db');

async function bootstrap() {
  try {
    await setupDb();                                   // CREATE DATABASE / TABLE IF NOT EXISTS (safe to repeat)
    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM users');
    if (n === 0) { await seedDemo({ log: console.log }); return; }          // brand-new database -> demo data
    if (!(await demoIsComplete())) {
      const [[{ d }]] = await db.query("SELECT COUNT(*) d FROM users WHERE email LIKE '%@unisphere.edu'");
      if (d <= 13) { console.log('Demo data was incomplete - reloading it.'); await seedDemo({ reset: true }); }
      else console.log('Note: some demo accounts or courses are missing. Run "npm run db:reset" to restore the demo data.');
    }
  } catch (e) {
    console.error('\nCould not prepare the database:', e.message, '\nStart MySQL in XAMPP and check the DB_* values in .env, then restart.\n');
  }
}
module.exports = { bootstrap };
