require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const app = express();
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'upgrade-insecure-requests': null
    }
  }
}));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/courses', require('./src/routes/courseRoutes'));
app.use('/api/enrollments', require('./src/routes/enrollmentRoutes'));
app.use('/api/student', require('./src/routes/studentRoutes'));
app.use('/api/faculty', require('./src/routes/facultyRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api', require('./src/routes/commonRoutes'));   // notifications, announcements, calendar, messages, files

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use(express.static(path.join(__dirname, 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 10 MB).' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message, code: err.code });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  require('./src/utils/bootstrap').bootstrap().then(() =>
    app.listen(PORT, () => console.log(`UniSphere running at http://localhost:${PORT}`)));
}
module.exports = app;
