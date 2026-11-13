// Creates the database (DB_NAME, default UniversityDB) and all tables from database/UniversityDB.sql
require('dotenv').config();
const fs = require('fs'); const path = require('path'); const mysql = require('mysql2/promise');

async function setupDb(dbName = process.env.DB_NAME || 'UniversityDB') {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'UniversityDB.sql'), 'utf8').replace(/UniversityDB/g, dbName);
    await conn.query(sql);
  } finally { await conn.end(); }
}
module.exports = { setupDb };

if (require.main === module) {
  setupDb().then(() => console.log('UniversityDB is ready.'))
    .catch((e) => { console.error('Database setup failed:', e.message, '\nIs MySQL running in XAMPP, and are the DB_* values in .env correct?'); process.exit(1); });
}
