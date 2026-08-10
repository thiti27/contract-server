import { Router } from 'express';
import { listEmployees } from '../controllers/employeeController.js';

const router = Router();

router.get('/employees', listEmployees);

export default router;
