// ─────────────────────────────────────────────────────────────────────────────
//  SchemeSnap · src/middleware/upload.js
//  Multer configuration – STRICT in-memory storage (zero disk writes).
//  Hard limits: 5 MB per file, PDF only.
// ─────────────────────────────────────────────────────────────────────────────

import multer from 'multer';
import path from 'path';

// ── Storage engine ─────────────────────────────────────────────────────────────
// memoryStorage() keeps every uploaded byte inside a Node.js Buffer allocated
// on the process heap.  Nothing is ever flushed to the filesystem.
const storage = multer.memoryStorage();

// ── File filter ────────────────────────────────────────────────────────────────
// Two independent checks are performed:
//   1. MIME type must be 'application/pdf'
//   2. The original file extension must be '.pdf' (case-insensitive)
// Both checks must pass; a single failure rejects the upload immediately.
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['application/pdf'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      Object.assign(new Error('Invalid file type: only PDF documents are accepted.'), { status: 415 }),
      false
    );
  }

  if (ext !== '.pdf') {
    return cb(
      Object.assign(new Error('Invalid file extension: file must have a .pdf extension.'), { status: 415 }),
      false
    );
  }

  cb(null, true);
};

// ── Multer instance ─────────────────────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB ceiling
    files: 1,                  // one file per request
  },
});

// ── Multer error normaliser middleware ─────────────────────────────────────────
// Wraps the raw Multer upload so that Multer-specific errors (e.g. file too
// large) surface as clean JSON responses with the correct HTTP status codes.
export const uploadSingle = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large: maximum allowed size is 5 MB.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Unexpected field. Send the PDF under the "document" field name.` });
    }

    // Custom errors thrown in fileFilter carry a .status property
    return res.status(err.status || 400).json({ error: err.message });
  });
};

export default upload;

