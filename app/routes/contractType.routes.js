import { Router } from 'express';
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

router.get('/contract-types', listContractTypes);
router.get('/admin/contract-types', listAdminContractTypes);
router.post('/admin/contract-types', createAdminContractType);
router.patch('/admin/contract-types/:id', updateAdminContractType);
router.post('/admin/contract-types/:id/purposes', createAdminPurpose);
router.patch('/admin/purposes/:id', updateAdminPurpose);
router.post('/admin/purposes/:id/form-item/:lang', attachFormItem);
router.delete('/admin/purposes/:id/form-item/:lang', removeFormItem);

export default router;
