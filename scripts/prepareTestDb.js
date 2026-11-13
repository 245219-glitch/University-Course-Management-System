// Builds a clean UniversityDB_test with the demo data before the tests run.
process.env.DB_NAME = 'UniversityDB_test';
require('dotenv').config();
const { setupDb } = require('./setupDb'); const { seedDemo } = require('./seed'); const db = require('../src/config/db');
(async () => { await setupDb('UniversityDB_test'); await seedDemo({ reset: true, log: () => {} }); await db.end(); console.log('Test database ready (UniversityDB_test).'); })()
  .catch((e) => { console.error('Could not prepare the test database:', e.message); process.exit(1); });
