import { Router } from 'express';
import { downloadContractPdf } from '../controllers/contractPdfController.js';

const router = Router();

router.get('/requests/:id/pdf', downloadContractPdf);

export default router;
