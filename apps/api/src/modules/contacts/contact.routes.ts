import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import { assignSchema, noteSchema } from '../leads/lead.validation';
import * as controller from './contact.controller';
import { createContactSchema, updateContactSchema } from './contact.validation';

export function createContactRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));
  const id = requireObjectIdParam('id', 'Contact');

  // Order: authenticate -> resolveOrganization -> requireMembership -> rate limit -> id check -> authorize -> validate -> controller
  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('contacts:read'), controller.list);
  router.get('/tags', authorize('contacts:read'), controller.tags); // before '/:id'
  router.post('/', authorize('contacts:create'), validate({ body: createContactSchema }), controller.create);

  router.get('/:id', id, authorize('contacts:read'), controller.get);
  router.patch('/:id', id, authorize('contacts:update'), validate({ body: updateContactSchema }), controller.update);
  router.delete('/:id', id, authorize('contacts:delete'), controller.remove);

  router.patch('/:id/assign', id, authorize('contacts:assign'), validate({ body: assignSchema }), controller.assign);
  router.post('/:id/restore', id, authorize('contacts:delete'), controller.restore);

  router.get('/:id/activities', id, authorize('activities:read'), controller.activities);
  router.post('/:id/notes', id, authorize('activities:create'), validate({ body: noteSchema }), controller.addNote);

  return router;
}