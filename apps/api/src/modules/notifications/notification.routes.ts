import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { requireObjectIdParam } from '../../utils/require-object-id';
import * as controller from './notification.controller';
import { validate } from '../../middleware/validate';
import * as prefs from './notification-preference.controller';
import { updatePreferencesSchema } from './notification-preference.validation';


export function createNotificationRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));
  const id = requireObjectIdParam('id', 'Notification');

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('notifications:read'), controller.list);
  router.get('/unread-count', authorize('notifications:read'), controller.unreadCount);
  router.patch('/read-all', authorize('notifications:manage'), controller.markAllRead);
  router.patch('/:id/read', id, authorize('notifications:manage'), controller.markRead);
  router.delete('/:id', id, authorize('notifications:manage'), controller.remove);
  router.get('/preferences', authorize('notifications:read'), prefs.get);
  router.patch('/preferences', authorize('notifications:preferences_update'), validate({ body: updatePreferencesSchema }), prefs.update);
  return router;
}