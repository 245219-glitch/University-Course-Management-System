require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'UniversityDB',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,      // keep DATE/DATETIME as plain strings (no timezone surprises)
  decimalNumbers: true    // return DECIMAL/SUM/AVG as numbers
});

module.exports = pool;
