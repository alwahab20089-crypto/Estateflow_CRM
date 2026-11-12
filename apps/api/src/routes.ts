import { Router } from 'express';
import { createRateLimiters, type RateLimitOptions } from './middleware/rate-limit';
import { createAuthRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { organizationRouter } from './modules/organizations/organization.routes';
import { createLeadRouter } from './modules/leads/lead.routes';
import { memberRouter } from './modules/members/member.routes';
import { createContactRouter } from './modules/contacts/contact.routes';
import { createPropertyRouter } from './modules/properties/property.routes';
import { createDealRouter } from './modules/deals/deal.routes';

export function createApiRouter(options: RateLimitOptions = {}) {
  const router = Router();
  const limiters = createRateLimiters(options);

  router.use('/health', healthRouter); // before rate limiting so monitors are never throttled
  router.use(limiters.global);
  router.use('/auth', createAuthRouter(limiters));
  router.use('/organizations', organizationRouter);
  router.use('/leads', createLeadRouter(limiters));
  router.use('/contacts', createContactRouter(limiters));
  router.use('/properties', createPropertyRouter(limiters));
  router.use('/deals', createDealRouter(limiters));
  router.use('/members', memberRouter);
  return router;
}