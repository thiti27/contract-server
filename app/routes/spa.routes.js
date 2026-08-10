import { Router } from 'express';
import { serveIndex } from '../controllers/spaController.js';

const router = Router();

router.get('*', serveIndex);

export default router;
