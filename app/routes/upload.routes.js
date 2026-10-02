import { Router } from 'express';
import { createUploads, downloadUpload, deleteUpload } from '../controllers/uploadController.js';
import { upload } from '../middleware/upload.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';

const router = Router();

router.post('/uploads', authenticate, upload.array('files', 20), createUploads);
// Optionally authenticated, not authenticate — same reasoning as request.routes.js's
// GET /requests/:id: the Contract Documents page's client-side zip build fetches each
// document through this same route, including for a logged-out visitor on a non-
// confidential contract. downloadUpload's own hasConfidentialAccess check (via
// findOwningContracts) is what actually enforces the real rule either way.
router.get('/uploads/:id/download', optionalAuthenticate, downloadUpload);
router.delete('/uploads/:id', authenticate, deleteUpload);

export default router;
