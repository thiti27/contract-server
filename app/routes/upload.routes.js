import { Router } from 'express';
import { createUploads, downloadUpload, deleteUpload } from '../controllers/uploadController.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.post('/uploads', upload.array('files', 20), createUploads);
router.get('/uploads/:id/download', downloadUpload);
router.delete('/uploads/:id', deleteUpload);

export default router;
