import { Router } from 'express';
import { createRequest, getRequest, updateRequest } from '../controllers/requestController.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';

const router = Router();

router.post('/requests', authenticate, createRequest);
// Optionally authenticated, not authenticate — the Contract Documents page
// (contractDocumentsController.js) reuses this same endpoint to fetch full detail for
// its client-side PDF/zip build, including for a logged-out visitor opening a non-
// confidential contract's link straight from email. getRequest's own
// hasConfidentialAccess(row, req.user) check still runs exactly as before either way —
// req.user just comes back undefined instead of the request being rejected outright,
// which is what actually lets a confidential row correctly 403 a logged-out visitor
// while a non-confidential one stays open to everyone.
router.get('/requests/:id', optionalAuthenticate, getRequest);
router.patch('/requests/:id', authenticate, updateRequest);

export default router;
