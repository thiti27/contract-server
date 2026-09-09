import { Router } from 'express';
import { approve, returnContract, reject, waive } from '../controllers/approvalController.js';

const router = Router();

router.post('/contract-request/:id/approve', approve);
router.post('/contract-request/:id/return', returnContract);
router.post('/contract-request/:id/reject', reject);
router.post('/contract-request/:id/waive', waive);

export default router;
