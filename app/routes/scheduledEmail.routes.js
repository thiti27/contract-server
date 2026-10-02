import { Router } from 'express';
import {
  draftedTrackingPreview,
  expirationReminderPreview,
  sendExpirationReminderNow,
  sendDraftedTrackingNow,
  sendDraftedTrackingFinalReminderNow,
} from '../controllers/scheduledEmailController.js';

const router = Router();

// Legal > Email Monitor — read-only calculation preview, see scheduledEmailPreview.service.js.
router.get('/scheduled-emails/drafted-tracking-preview', draftedTrackingPreview);
router.get('/scheduled-emails/expiration-reminder-preview', expirationReminderPreview);
// Manual test-sends — real sends, see each job file's own sendXNow function.
router.post('/scheduled-emails/expiration-reminder/:id/send', sendExpirationReminderNow);
router.post('/scheduled-emails/drafted-tracking/:section/:round/send', sendDraftedTrackingNow);
router.post('/scheduled-emails/drafted-tracking-final/:section/:round/send', sendDraftedTrackingFinalReminderNow);

export default router;
