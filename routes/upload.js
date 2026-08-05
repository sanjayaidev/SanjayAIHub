const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ──────────────────────────────────────────────
// POST /api/upload - Generic file upload used by modules that need a
// public URL for a user-supplied source file (image-edit, image-to-video,
// video-to-video, voice-clone). Providers (Alibaba/Pixazo/ElevenLabs) take
// a URL, not raw bytes, so the frontend uploads the file here first and
// then passes the returned `url` on to the module's generate endpoint.
//
// Auth is optional here: imageedit.html and image-video.html send a Bearer
// token, but voiceclone.html and video-edit.html currently don't. Rather
// than break those two pages, we accept both — if a valid token is present
// we attach req.user, but we don't require one.
// ──────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET;

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) req.user = decoded;
    next();
  });
}

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  // images (image-edit, image-to-video source frame)
  'image/jpeg',
  'image/png',
  'image/webp',
  // video (video-to-video source clip)
  'video/mp4',
  'video/quicktime',
  'video/webm',
  // audio (voice-clone sample)
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, matches body limit headroom
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

router.post('/', optionalAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 25MB)' : err.message)
        : err.message;
      return res.status(400).json({ success: false, message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = process.env.PUBLIC_BASE_URL || `${protocol}://${req.get('host')}`;
    const url = `${baseUrl}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  });
});

module.exports = router;
