import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import {
  listContractTypes,
  listAdminContractTypes,
  createAdminContractType,
  updateAdminContractType,
  createAdminPurpose,
  updateAdminPurpose,
  attachFormItem,
  removeFormItem,
} from '../controllers/contractTypeController.js';

const router = Router();

// Public — a logged-out visitor's Drafted-status Contract Documents download
// (downloadDraftedContractZip.js) needs this for the type's ENG/THA procedure
// templates and allowCustomPurpose flag, same reasoning as GET /requests/:id and
// GET /uploads/:id/download already being optionally authenticated (see
// app/routes/index.js's own comment on why this file is mounted ahead of the blanket
// authenticate block).
router.get('/contract-types', optionalAuthenticate, listContractTypes);

// This whole file is mounted ahead of app/routes/index.js's blanket authenticate
// block (see that file's own comment on why), so every route below needs its own
// explicit authenticate — it no longer inherits one from the mount.
router.get('/admin/contract-types', authenticate, listAdminContractTypes);
router.post('/admin/contract-types', authenticate, createAdminContractType);
router.patch('/admin/contract-types/:id', authenticate, updateAdminContractType);
router.post('/admin/contract-types/:id/purposes', authenticate, createAdminPurpose);
router.patch('/admin/purposes/:id', authenticate, updateAdminPurpose);
router.post('/admin/purposes/:id/form-item/:lang', authenticate, attachFormItem);
router.delete('/admin/purposes/:id/form-item/:lang', authenticate, removeFormItem);

export default router;
