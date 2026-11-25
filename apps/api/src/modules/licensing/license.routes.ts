import { Router, type RequestHandler } from 'express';
import { authenticate, getAuth } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { getTenant, requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import * as license from './license.service';
import { activateLicenseSchema } from './license.validation';

export function createLicenseRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  // Every member may read the short status: it drives the expiry banner and disabled buttons.
  router.get(
    '/status',
    authorize('org:read'),
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(res, { data: await license.getLicenseStatus(getTenant(req)) });
    }),
  );

  router.get(
    '/current',
    authorize('license:read'),
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(res, { data: await license.getLicenseOverview(getTenant(req)) });
    }),
  );

  router.post(
    '/activate',
    authorize('license:manage'),
    validate({ body: activateLicenseSchema }),
    asyncHandler(async (req, res) => {
      const data = await license.activateLicense(getTenant(req), getAuth(req).userId, req.body.licenseKey, getRequestMeta(req));
      sendSuccess(res, { message: 'License activated', data });
    }),
  );

  router.post(
    '/deactivate',
    authorize('license:manage'),
    asyncHandler(async (req, res) => {
      const data = await license.deactivateLicense(getTenant(req), getAuth(req).userId, getRequestMeta(req));
      sendSuccess(res, { message: 'License deactivated', data });
    }),
  );

  return router;
}