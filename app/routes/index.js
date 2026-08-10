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
import spaRoutes from './spa.routes.js';

const router = Router();

// Login is the only /api route that doesn't require a token — it's what produces one.
router.use('/api', authRoutes);

// Every other /api route requires `Authorization: Bearer <token>` (see
// app/middleware/auth.js) — matches every endpoint's existing path exactly, just with
// authenticate applied in front of each.
router.use('/api', authenticate, contractRoutes);
router.use('/api', authenticate, metaRoutes);
router.use('/api', authenticate, employeeRoutes);
router.use('/api', authenticate, contractTypeRoutes);
router.use('/api', authenticate, globalDocumentRoutes);
router.use('/api', authenticate, uploadRoutes);
router.use('/api', authenticate, requestRoutes);
router.use('/api', authenticate, approvalRoutes);
router.use('/api', authenticate, approvalHistoryRoutes);
router.use('/api', authenticate, legalRoutes);
router.use('/api', authenticate, legalHistoryRoutes);
router.use('/api', authenticate, signedContractRoutes);
router.use('/api', authenticate, formRoutes);

// SPA fallback must be registered last — same ordering the original server.js used
// (app.get('*', ...) as the very last route) — so it only ever catches paths no
// earlier route (API or static) already matched.
router.use(spaRoutes);

export default router;
