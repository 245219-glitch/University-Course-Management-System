// One command to fix a broken or half-filled database: npm run db:reset
// Creates the database + tables if needed, wipes every table and loads the full demo data.
require('dotenv').config();
const { setupDb } = require('./setupDb'); const { seedDemo } = require('./seed'); const db = require('../src/config/db');
(async () => { await setupDb(); await seedDemo({ reset: true }); await db.end(); })()
  .catch((e) => { console.error('Reset failed:', e.message, '\nIs MySQL running in XAMPP, and are the DB_* values in .env correct?'); process.exit(1); });
