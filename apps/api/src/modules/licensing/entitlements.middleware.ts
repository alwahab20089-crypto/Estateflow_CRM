import type { RequestHandler } from 'express';
import { getTenant } from '../../middleware/require-membership';
import { asyncHandler } from '../../utils/async-handler';
import type { FeatureKey, LimitKey } from './license.catalog';
import { acquireUsageSlot, assertFeature, assertWithinLimit } from './entitlements.service';

/** Server-side feature gate. Runs after requireMembership. Hiding a button is never the restriction. */
export const requireFeature = (feature: FeatureKey): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    await assertFeature(getTenant(req).organizationId, feature);
    next();
  });

/**
 * Use on routes that CREATE (or restore) a counted record. It takes the per-organization slot, checks the limit
 * and releases the slot when the response finishes, so concurrent requests are serialized and the limit is exact.
 */
export const enforceLimit = (key: LimitKey): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    const organizationId = getTenant(req).organizationId;
    const release = await acquireUsageSlot(organizationId, key);
    let released = false;
    const done = () => {
      if (!released) {
        released = true;
        void release();
      }
    };
    res.once('close', done);
    try {
      await assertWithinLimit(organizationId, key);
    } catch (err) {
      done();
      throw err;
    }
    next();
  });