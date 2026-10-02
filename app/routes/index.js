import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import contractRoutes from './contract.routes.js';
import metaRoutes from './meta.routes.js';
import authRoutes from './auth.routes.js';
import employeeRoutes from './employee.routes.js';
import contractTypeRoutes from './contractType.routes.js';
import globalDocumentRoutes from './globalDocument.routes.js';
import uploadRoutes from './upload.routes.js';
import requestRoutes from './request.routes.js';
import approvalRoutes from './approval.routes.js';
import approvalHistoryRoutes from './approvalHistory.routes.js';
import legalRoutes from './legal.routes.js';
import legalHistoryRoutes from './legalHistory.routes.js';
import signedContractRoutes from './signedContract.routes.js';
import formRoutes from './form.routes.js';
import roleRoutes from './role.routes.js';
import contractDocumentsRoutes from './contractDocuments.routes.js';
import scheduledEmailRoutes from './scheduledEmail.routes.js';
import activityLogRoutes from './activityLog.routes.js';

const router = Router();

// Login is the only /api route that doesn't require a token — it's what produces one.
router.use('/api', authRoutes);

// uploadRoutes, requestRoutes, contractDocumentsRoutes, contractTypeRoutes and
// globalDocumentRoutes MUST be mounted before any blanket `authenticate`-gated
// `.use('/api', authenticate, ...)` below — Express runs `authenticate` for every
// request whose path starts with '/api', before it ever tries to match that request
// against the sub-router that follows, regardless of whether that sub-router even has
// a route for it. Registering these after the authenticate-gated mounts (as originally
// written) meant a logged-out request for one of their public GETs got 401'd by the
// FIRST blanket mount (contractRoutes') authenticate check, before Express ever
// reached the router that actually owns that path — this ordering is what actually
// lets a public request fall through to them. Each of these 5 files applies
// authenticate/optionalAuthenticate itself, per-route (GET /uploads/:id/download,
// GET /requests/:id, GET /contract-types, GET /global-documents — all 4 needed by a
// logged-out visitor's Drafted-status Contract Documents download,
// downloadDraftedContractZip.js), while every other route in these same files stays
// strictly authenticated — see each file's own comment.
router.use('/api', uploadRoutes);
router.use('/api', requestRoutes);
router.use('/api', contractTypeRoutes);
router.use('/api', globalDocumentRoutes);
// Contract Documents (public page behind an email link) — public for a non-
// confidential contract, login-gated for HIGH CONFIDENTIAL — never blanket-
// authenticated; see contractDocuments.routes.js.
router.use('/api', contractDocumentsRoutes);

// Every other /api route requires `Authorization: Bearer <token>` (see
// app/middleware/auth.js) — matches every endpoint's existing path exactly, just with
// authenticate applied in front of each.
router.use('/api', authenticate, contractRoutes);
router.use('/api', authenticate, metaRoutes);
router.use('/api', authenticate, employeeRoutes);
router.use('/api', authenticate, approvalRoutes);
router.use('/api', authenticate, approvalHistoryRoutes);
router.use('/api', authenticate, legalRoutes);
router.use('/api', authenticate, legalHistoryRoutes);
router.use('/api', authenticate, signedContractRoutes);
router.use('/api', authenticate, formRoutes);
router.use('/api', authenticate, roleRoutes);
router.use('/api', authenticate, scheduledEmailRoutes);
router.use('/api', authenticate, activityLogRoutes);

export default router;
