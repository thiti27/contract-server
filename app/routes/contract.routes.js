import { Router } from 'express';
import { listContracts } from '../controllers/contractController.js';

const router = Router();

router.get('/contracts', listContracts);

export default router;
