import { Router } from 'express';
import { comment, check, terminate, noNeed, cancel } from '../controllers/legalController.js';

const router = Router();

router.post('/contract-request/:id/legal-comment', comment);
router.post('/contract-request/:id/legal-check', check);
router.post('/contract-request/:id/legal-terminate', terminate);
router.post('/contract-request/:id/legal-no-need', noNeed);
router.post('/contract-request/:id/legal-cancel', cancel);

export default router;
