import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { AppError } from '../../utils/app-error';
import * as controller from './report.controller';

export function createReportRouter() {
  const router = Router();

  const limit = (max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
      handler: (_req, _res, next) => next(AppError.tooManyRequests()),
    });

  router.use(authenticate, resolveOrganization('header'), requireMembership);

  router.get('/', authorize('reports:read'), controller.catalog);

  router.get('/:reportId', authorize('reports:read'), limit(90), controller.run);

  router.get(
    '/:reportId/export',
    authorize('reports:read', 'reports:export'),
    limit(10),
    controller.exportCsv,
  );

  return router;
}