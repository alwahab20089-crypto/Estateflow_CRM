import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import { enforceLimit } from '../commercial/entitlements.middleware';
import * as controller from './lead.controller';
import {
  assignSchema,
  createLeadSchema,
  noteSchema,
  statusSchema,
  updateLeadSchema,
} from './lead.validation';
import * as contactController from '../contacts/contact.controller';
import { convertLeadSchema } from '../contacts/contact.validation';

export function createLeadRouter(limiters: RateLimiters) {
  const router = Router();

  const writesOnly: RequestHandler = (req, res, next) =>
    req.method === 'GET' ? next() : limiters.write(req, res, next);

  const id = requireObjectIdParam('id', 'Lead');

  // authenticate -> resolveOrganization -> requireMembership
  // -> rate limit -> id check -> authorize -> entitlement -> validate -> controller
  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('leads:read'), controller.list);

  router.post(
    '/',
    authorize('leads:create'),
    enforceLimit('leads'),
    validate({ body: createLeadSchema }),
    controller.create,
  );

  router.get('/:id', id, authorize('leads:read'), controller.get);

  router.patch(
    '/:id',
    id,
    authorize('leads:update'),
    validate({ body: updateLeadSchema }),
    controller.update,
  );

  router.delete('/:id', id, authorize('leads:delete'), controller.remove);

  router.patch(
    '/:id/status',
    id,
    authorize('leads:update'),
    enforceLimit('leads'),
    validate({ body: statusSchema }),
    controller.updateStatus,
  );

  router.patch(
    '/:id/assign',
    id,
    authorize('leads:assign'),
    validate({ body: assignSchema }),
    controller.assign,
  );

  router.post(
    '/:id/restore',
    id,
    authorize('leads:delete'),
    enforceLimit('leads'),
    controller.restore,
  );

  router.get('/:id/activities', id, authorize('activities:read'), controller.activities);

  router.post(
    '/:id/notes',
    id,
    authorize('activities:create'),
    validate({ body: noteSchema }),
    controller.addNote,
  );

  router.post(
    '/:id/convert-to-contact',
    id,
    authorize('leads:convert'),
    validate({ body: convertLeadSchema }),
    contactController.convertLead,
  );

  return router;
}
