import { Router } from 'express';
import { getContractDocumentsInfo } from '../controllers/contractDocumentsController.js';
import { optionalAuthenticate } from '../middleware/auth.js';

const router = Router();

// Never behind the blanket authenticate (see app/routes/index.js) — this route must
// answer for a logged-out visitor too, that's the whole point of the page. optionalAuthenticate
// still resolves req.user when a token IS present, so a visitor who's already logged
// in gets an accurate authorized:true/false instead of always looking anonymous.
router.get('/contract-documents/:contractNo', optionalAuthenticate, getContractDocumentsInfo);

export default router;
