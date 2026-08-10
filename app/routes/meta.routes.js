import { Router } from 'express';
import { getMeta } from '../controllers/metaController.js';

const router = Router();

router.get('/meta', getMeta);

export default router;
