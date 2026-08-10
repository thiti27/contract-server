import { Router } from 'express';
import { listForms } from '../controllers/formController.js';

const router = Router();

router.get('/forms', listForms);

export default router;
