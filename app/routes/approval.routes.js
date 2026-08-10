import { Router } from 'express';
import { approve, returnContract, reject } from '../controllers/approvalController.js';

const router = Router();

router.post('/contract-request/:id/approve', approve);
router.post('/contract-request/:id/return', returnContract);
router.post('/contract-request/:id/reject', reject);

export default router;
