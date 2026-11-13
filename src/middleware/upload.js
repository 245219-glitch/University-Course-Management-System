const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip', '.png', '.jpg', '.jpeg'];
const make = (folder) => multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'uploads', folder),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    const err = new Error('File type not allowed. Allowed: ' + ALLOWED.join(', ')); err.status = 400; cb(err);
  }
});
module.exports = { materials: make('materials'), submissions: make('submissions') };
