import { Router } from 'express';
import { uploadSigned } from '../controllers/signedContractController.js';

const router = Router();

router.post('/contract-request/:id/upload-signed', uploadSigned);

export default router;
