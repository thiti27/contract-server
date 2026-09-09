import { Router } from 'express';
import { listContracts, exportContracts } from '../controllers/contractController.js';

const router = Router();

// Registered before '/contracts' isn't required (different full paths, no :id
// segment here to collide with), but kept above it anyway to read as "the more
// specific route first" for anyone skimming this file.
router.get('/contracts/export', exportContracts);
router.get('/contracts', listContracts);

export default router;
