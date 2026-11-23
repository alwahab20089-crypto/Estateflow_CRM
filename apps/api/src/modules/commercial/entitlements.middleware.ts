import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import { getTenant } from '../../middleware/require-membership';
import { AppError } from '../../utils/app-error';
import { asyncHandler } from '../../utils/async-handler';
import type { FeatureKey, LimitKey } from './commercial.catalog';
import { acquireUsageSlot, assertFeature, assertWithinLimit } from './entitlements.service';

/** Server-side feature gate. Runs after requireMembership. Hiding a button is never the restriction. */
export const requireFeature = (feature: FeatureKey): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    await assertFeature(getTenant(req).organizationId, feature);
    next();
  });

/**
 * Use on routes that CREATE (or restore/reopen) a counted record. It takes the per-organization slot, checks the limit
 * and releases the slot when the response finishes, so concurrent requests are serialized and the limit is exact.
 */
export const enforceLimit = (key: LimitKey): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    const organizationId = getTenant(req).organizationId;
    const release = await acquireUsageSlot(organizationId, key);
    let released = false;
    const done = () => { if (!released) { released = true; void release(); } };
    res.once('close', done);
    try {
      await assertWithinLimit(organizationId, key);
    } catch (err) {
      done();
      throw err;
    }
    next();
  });

/** Routes that only exist in one edition answer exactly like an unknown route in the other. */
export const requireEdition = (mode: 'SAAS' | 'SELF_HOSTED'): RequestHandler => (_req, _res, next) =>
  env.DEPLOYMENT_MODE === mode ? next() : next(AppError.notFound('Not found'));