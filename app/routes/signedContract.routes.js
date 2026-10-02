import { Router } from 'express';
import { uploadSigned, originalAt } from '../controllers/signedContractController.js';

const router = Router();

router.post('/contract-request/:id/upload-signed', uploadSigned);
router.post('/contract-request/:id/original-at', originalAt);

export default router;
