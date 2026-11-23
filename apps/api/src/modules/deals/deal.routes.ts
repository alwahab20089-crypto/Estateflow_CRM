
import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import { enforceLimit } from '../commercial/entitlements.middleware';
import { assignSchema } from '../leads/lead.validation';
import * as controller from './deal.controller';
import {
  closeLostSchema,
  closeWonSchema,
  createDealSchema,
  dealStageSchema,
  reopenSchema,
  updateDealSchema,
} from './deal.validation';

export function createDealRouter(limiters: RateLimiters) {
  const router = Router();

  const writesOnly: RequestHandler = (req, res, next) =>
    req.method === 'GET' ? next() : limiters.write(req, res, next);

  const id = requireObjectIdParam('id', 'Deal');

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('deals:read'), controller.list);

  router.post(
    '/',
    authorize('deals:create'),
    enforceLimit('deals'),
    validate({ body: createDealSchema }),
    controller.create,
  );

  router.get('/:id', id, authorize('deals:read'), controller.get);

  router.patch(
    '/:id',
    id,
    authorize('deals:update'),
    validate({ body: updateDealSchema }),
    controller.update,
  );

  router.delete('/:id', id, authorize('deals:delete'), controller.remove);

  router.patch(
    '/:id/stage',
    id,
    authorize('deals:update'),
    validate({ body: dealStageSchema }),
    controller.stage,
  );

  router.patch('/:id/assign', id, authorize('deals:assign'), validate({ body: assignSchema }), controller.assign);

  router.post('/:id/close-won', id, authorize('deals:update'), validate({ body: closeWonSchema }), controller.closeWon);

  router.post('/:id/close-lost', id, authorize('deals:update'), validate({ body: closeLostSchema }), controller.closeLost);

  router.post(
    '/:id/reopen',
    id,
    authorize('deals:reopen'),
    enforceLimit('deals'),
    validate({ body: reopenSchema }),
    controller.reopen,
  );
  router.get('/:id/activities', id, authorize('activities:read'), controller.activities);

  return router;
}
