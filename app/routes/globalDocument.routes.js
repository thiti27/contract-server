import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { getGlobalDocuments, setGlobalDocument } from '../controllers/globalDocumentController.js';

const router = Router();

// Public — same reasoning as contractType.routes.js's own GET /contract-types: a
// logged-out visitor's Drafted-status Contract Documents download needs the Check
// Sheet path this returns.
router.get('/global-documents', optionalAuthenticate, getGlobalDocuments);
// This file is mounted ahead of app/routes/index.js's blanket authenticate block (see
// that file's own comment on why), so this route needs its own explicit authenticate —
// it no longer inherits one from the mount.
router.post('/admin/global-documents/:key', authenticate, setGlobalDocument);

export default router;
