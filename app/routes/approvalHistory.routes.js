import { Router } from 'express';
import { listApprovalHistory } from '../controllers/approvalHistoryController.js';

const router = Router();

router.get('/approval-history', listApprovalHistory);

export default router;
