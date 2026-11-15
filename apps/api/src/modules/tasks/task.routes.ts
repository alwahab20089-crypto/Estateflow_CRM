import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import { assignSchema } from '../leads/lead.validation';
import * as controller from './task.controller';
import { completeTaskSchema, createTaskSchema, taskStatusSchema, updateTaskSchema } from './task.validation';

export function createTaskRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));
  const id = requireObjectIdParam('id', 'Task');

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  // Static paths first so they are never captured by /:id
  router.get('/calendar', authorize('tasks:read'), controller.calendar);
  router.get('/summary', authorize('tasks:read'), controller.summary);

  router.get('/', authorize('tasks:read'), controller.list);
  router.post('/', authorize('tasks:create'), validate({ body: createTaskSchema }), controller.create);

  router.get('/:id', id, authorize('tasks:read'), controller.get);
  router.patch('/:id', id, authorize('tasks:update'), validate({ body: updateTaskSchema }), controller.update);
  router.delete('/:id', id, authorize('tasks:delete'), controller.remove);

  router.patch('/:id/status', id, authorize('tasks:update'), validate({ body: taskStatusSchema }), controller.status);
  router.patch('/:id/assign', id, authorize('tasks:assign'), validate({ body: assignSchema }), controller.assign);
  router.patch('/:id/complete', id, authorize('tasks:update'), validate({ body: completeTaskSchema }), controller.complete);
  router.patch('/:id/restore', id, authorize('tasks:restore'), controller.restore);

  router.get('/:id/activities', id, authorize('activities:read'), controller.activities);
  return router;
}