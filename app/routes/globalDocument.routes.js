import { Router } from 'express';
import { getGlobalDocuments, setGlobalDocument } from '../controllers/globalDocumentController.js';

const router = Router();

router.get('/global-documents', getGlobalDocuments);
router.post('/admin/global-documents/:key', setGlobalDocument);

export default router;
