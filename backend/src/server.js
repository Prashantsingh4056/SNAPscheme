// ─────────────────────────────────────────────────────────────────────────────
//  SchemeSnap · src/server.js
//  Express application entry-point.
//  Security model: zero-disk-write – all file bytes live exclusively in RAM.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import policyRoutes from './routes/policyRoutes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only the Vite dev-server origin is whitelisted.  Credentials headers are
// permitted so future session-cookie work doesn't require CORS rework.
app.use(
  cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
// multipart/form-data is handled by Multer inside each route; we only need
// the JSON parser for any future non-file endpoints.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health probe ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'SchemeSnap API', timestamp: new Date().toISOString() });
});

// ── Policy routes ─────────────────────────────────────────────────────────────
app.use('/api', policyRoutes);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[SchemeSnap] Unhandled error →', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  SchemeSnap API running on http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/api/health\n`);
});

