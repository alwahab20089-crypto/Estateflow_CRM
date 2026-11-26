import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import { assignSchema } from '../leads/lead.validation';
import * as controller from './property.controller';
import { parseImageUpload } from './property.images';
import {
  createPropertySchema,
  propertyStatusSchema,
  updatePropertySchema,
} from './property.validation';
import { enforceLimit } from '../licensing/entitlements.middleware';

export function createPropertyRouter(limiters: RateLimiters) {
  const router = Router();

  const writesOnly: RequestHandler = (req, res, next) =>
    req.method === 'GET' ? next() : limiters.write(req, res, next);

  const id = requireObjectIdParam('id', 'Property');
  const imageId = requireObjectIdParam('imageId', 'Image');

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('properties:read'), controller.list);

  router.post(
    '/',
    authorize('properties:create'),
    enforceLimit('properties'),
    validate({ body: createPropertySchema }),
    controller.create,
  );

  router.get('/:id', id, authorize('properties:read'), controller.get);

  router.patch(
    '/:id',
    id,
    authorize('properties:update'),
    validate({ body: updatePropertySchema }),
    controller.update,
  );

  router.delete('/:id', id, authorize('properties:update'), controller.remove);

  router.patch(
    '/:id/status',
    id,
    authorize('properties:update'),
    validate({ body: propertyStatusSchema }),
    controller.status,
  );

  router.patch(
    '/:id/assign',
    id,
    authorize('properties:assign'),
    validate({ body: assignSchema }),
    controller.assign,
  );

  router.post('/:id/images', id, authorize('properties:update'), parseImageUpload, controller.addImages);

  router.delete(
    '/:id/images/:imageId',
    id,
    imageId,
    authorize('properties:update'),
    controller.removeImage,
  );

  router.post(
    '/:id/restore',
    id,
    authorize('properties:delete'),
    enforceLimit('properties'),
    controller.restore,
  );

  router.get('/:id/activities', id, authorize('activities:read'), controller.activities);

  return router;
}