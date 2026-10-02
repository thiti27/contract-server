import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { listActivityLogs, listActivityLogActions } from '../controllers/activityLogController.js';

const router = Router();

// authenticate is already applied to every route in this router (see routes/index.js);
// requireAdmin stacks an additional check on top, same convention as role.routes.js.
router.get('/admin/activity-logs', requireAdmin, listActivityLogs);
router.get('/admin/activity-logs/actions', requireAdmin, listActivityLogActions);

export default router;
