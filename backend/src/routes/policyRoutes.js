// ─────────────────────────────────────────────────────────────────────────────
//  SchemeSnap · src/routes/policyRoutes.js
//  Maps API endpoints to their controller handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { uploadSingle } from '../middleware/upload.js';
import { simplifyPolicy } from '../controllers/policyController.js';

const router = Router();

// POST /api/simplify
// Multipart field name: "document"  (must contain a single PDF ≤ 5 MB)
// Body field: "language" (optional string, defaults to "English")
router.post('/simplify', uploadSingle('document'), simplifyPolicy);

export default router;

