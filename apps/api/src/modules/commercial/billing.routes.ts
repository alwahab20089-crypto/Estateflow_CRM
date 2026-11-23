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
import { receiveBillingWebhook } from './billing.webhook';
import * as billing from './billing.service';
import { checkoutSchema } from './billing.validation';
import { requireEdition } from './entitlements.middleware';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });

export function createBillingRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));
  // Provider-backed billing exists only in the SaaS edition; self-hosted installations use licenses instead.
  router.use(requireEdition('SAAS'), authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/plans', authorize('billing:read'), asyncHandler(async (_req, res) => sendSuccess(res, { data: await billing.listPlans() })));
  router.get('/subscription', authorize('billing:read'), asyncHandler(async (req, res) => sendSuccess(res, { data: await billing.getSubscriptionOverview(ctx(req).tenant) })));
  router.get('/usage', authorize('billing:read'), asyncHandler(async (req, res) => sendSuccess(res, { data: await billing.usageOverview(ctx(req).tenant) })));

  router.post('/checkout', authorize('billing:manage'), validate({ body: checkoutSchema }), asyncHandler(async (req, res) => {
    const { tenant, userId, meta } = ctx(req);
    sendSuccess(res, { data: await billing.createCheckout(tenant, userId, req.body, meta) });
  }));
  router.post('/checkout/abandon', authorize('billing:manage'), asyncHandler(async (req, res) => sendSuccess(res, { data: await billing.abandonCheckout(ctx(req).tenant) })));
  router.post('/change-plan', authorize('billing:manage'), validate({ body: checkoutSchema }), asyncHandler(async (req, res) => {
    const { tenant, userId, meta } = ctx(req);
    sendSuccess(res, { data: await billing.changePlan(tenant, userId, req.body, meta) });
  }));
  router.post('/portal', authorize('billing:manage'), asyncHandler(async (req, res) => sendSuccess(res, { data: await billing.portalUrl(ctx(req).tenant) })));
  router.post('/cancel', authorize('billing:manage'), asyncHandler(async (req, res) => {
    const { tenant, userId, meta } = ctx(req);
    sendSuccess(res, { message: 'Cancellation requested', data: await billing.cancelSubscription(tenant, userId, meta) });
  }));
  router.post('/resume', authorize('billing:manage'), asyncHandler(async (req, res) => {
    const { tenant, userId, meta } = ctx(req);
    sendSuccess(res, { message: 'Subscription resumed', data: await billing.resumeSubscription(tenant, userId, meta) });
  }));
  return router;
}

/** No session, no CSRF header, no tenant: authenticity comes ONLY from the provider's signature over the raw body. */
export function createBillingWebhookRouter() {
  const router = Router();
  router.post('/billing/:provider', requireEdition('SAAS'), asyncHandler(async (req, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const result = await receiveBillingWebhook(String(req.params.provider), raw, req.headers);
    sendSuccess(res, { data: { received: true, result } });
  }));
  return router;
}