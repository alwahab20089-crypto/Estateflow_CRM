import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { AppError } from '../../utils/app-error';
import * as controller from './analytics.controller';

export function createAnalyticsRouter() {
  const router = Router();

  // Aggregations are expensive reads: throttle them per user.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 90,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    handler: (_req, _res, next) => next(AppError.tooManyRequests()),
  });

  router.use(authenticate, resolveOrganization('header'), requireMembership);

  router.use(limiter);

  router.get('/overview', authorize('analytics:read'), controller.getOverview);
  router.get('/leads', authorize('analytics:read', 'leads:read'), controller.getLeads);
  router.get('/deals', authorize('analytics:read', 'deals:read'), controller.getDeals);
  router.get('/properties', authorize('analytics:read', 'properties:read'), controller.getProperties);
  router.get('/team', authorize('analytics:read', 'analytics:team'), controller.getTeam);
  router.get('/tasks', authorize('analytics:read', 'tasks:read'), controller.getTasks);
  router.get('/revenue', authorize('analytics:read', 'deals:read'), controller.getRevenue);
  router.get('/trends', authorize('analytics:read'), controller.getTrends);

  return router;
}