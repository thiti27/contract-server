import { Router } from 'express';
import { listLegalHistory } from '../controllers/legalHistoryController.js';

const router = Router();

router.get('/legal-history', listLegalHistory);

export default router;
