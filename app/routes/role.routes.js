import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { listRoles, createRole, updateRole, deleteRole } from '../controllers/roleController.js';

const router = Router();

// authenticate is already applied to every route in this router (see routes/index.js);
// requireAdmin stacks an additional check on top — logged in isn't enough here, the
// caller's own session must carry admin: true (see authController's JWT payload).
router.get('/admin/roles', requireAdmin, listRoles);
router.post('/admin/roles', requireAdmin, createRole);
router.patch('/admin/roles/:id', requireAdmin, updateRole);
router.delete('/admin/roles/:id', requireAdmin, deleteRole);

export default router;
