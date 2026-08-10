import { Router } from 'express';
import { createRequest, getRequest, updateRequest } from '../controllers/requestController.js';

const router = Router();

router.post('/requests', createRequest);
router.get('/requests/:id', getRequest);
router.patch('/requests/:id', updateRequest);

export default router;
