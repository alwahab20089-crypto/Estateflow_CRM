import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import { Deal } from '../deals/deal.model';
import { Invitation } from '../invitations/invitation.model';
import { Lead } from '../leads/lead.model';
import { OrganizationMember } from '../members/member.model';
import { Property } from '../properties/property.model';
import {
  LIMIT_KEYS,
  RESTRICTED_ENTITLEMENTS,
  normalizeFeatures,
  normalizeLimits,
  type Entitlements,
  type FeatureKey,
  type LimitKey,
  type LicenseState,
} from './license.catalog';
import { License, UsageLock, type LicenseRecord } from './license.model';

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));
const DAY_MS = 86_400_000;

/* ----------------------------------------------------------------- license state */

/**
 * The state of the ACTIVE license row at a point in time. The end date is checked here, not only the stored status,
 * so a stale ACTIVE row can never grant access forever. After the end date the install keeps working for
 * LICENSE_GRACE_DAYS (state GRACE), then it is restricted (state EXPIRED).
 */
export function evaluateLicense(
  lic: Pick<LicenseRecord, 'expiresAt'>,
  now = new Date(),
  graceDays = env.LICENSE_GRACE_DAYS,
): { state: Extract<LicenseState, 'ACTIVE' | 'GRACE' | 'EXPIRED'>; graceEndsAt: Date | null } {
  if (!lic.expiresAt) return { state: 'ACTIVE', graceEndsAt: null };
  const graceEndsAt = new Date(lic.expiresAt.getTime() + graceDays * DAY_MS);
  if (lic.expiresAt.getTime() > now.getTime()) return { state: 'ACTIVE', graceEndsAt };
  return { state: graceEndsAt.getTime() > now.getTime() ? 'GRACE' : 'EXPIRED', graceEndsAt };
}

/* ----------------------------------------------------------------- entitlement source */

type Source = (organizationId: string) => Promise<Entitlements>;

/**
 * The single entitlement source. CRM modules never depend on where entitlements come from; tests can swap the source
 * through registerEntitlementSource.
 */
export const licenseEntitlementSource: Source = async (organizationId) => {
  const org = oid(organizationId);
  // At most one row is ACTIVE (partial unique index). Deactivating or revoking it never falls back to an older key.
  const active = await License.findOne({ organizationId: org, status: 'ACTIVE' }).lean();

  if (active) {
    const { state, graceEndsAt } = evaluateLicense(active);
    const base = { edition: active.edition, validUntil: active.expiresAt ?? null, graceEndsAt, state };
    if (state === 'EXPIRED') return { ...RESTRICTED_ENTITLEMENTS, ...base };
    return { ...base, source: 'LICENSE', features: normalizeFeatures(active.features), limits: normalizeLimits(active.limits) };
  }

  const last = await License.findOne({ organizationId: org }).sort({ updatedAt: -1 }).lean();
  if (!last) return RESTRICTED_ENTITLEMENTS;
  return {
    ...RESTRICTED_ENTITLEMENTS,
    edition: last.edition,
    state: last.status === 'REVOKED' ? 'REVOKED' : 'INACTIVE',
    validUntil: last.expiresAt ?? null,
  };
};

let activeSource: Source = licenseEntitlementSource;

export const registerEntitlementSource = (source: Source) => {
  activeSource = source;
  cache.clear();
};

const cache = new Map<string, { at: number; value: Entitlements }>();
const TTL_MS = env.NODE_ENV === 'test' ? 0 : 15_000;

export const invalidateEntitlements = (organizationId?: string) =>
  organizationId ? cache.delete(organizationId) : cache.clear();

/** The single entry point. Resolved on the server from persisted state only: no request value is ever consulted. */
export async function getOrganizationEntitlements(organizationId: string): Promise<Entitlements> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await activeSource(organizationId);
  cache.set(organizationId, { at: Date.now(), value });
  return value;
}

export async function hasFeature(organizationId: string, feature: FeatureKey) {
  return (await getOrganizationEntitlements(organizationId)).features[feature] === true;
}

/* ----------------------------------------------------------------- usage (always derived from the source records) */

/**
 * What counts toward each limit (deleted records never count; closed records DO, so reopening can never bypass a limit):
 *  members: active accepted memberships + pending invitations that have not expired
 *  leads / properties / deals: every record that is not soft-deleted
 */
export async function countUsage(organizationId: string, key: LimitKey): Promise<number> {
  const org = oid(organizationId);
  switch (key) {
    case 'members': {
      const [members, invited] = await Promise.all([
        OrganizationMember.countDocuments({ organizationId: org, status: 'ACTIVE', invitationStatus: 'ACCEPTED' }),
        Invitation.countDocuments({ organizationId: org, status: 'PENDING', expiresAt: { $gt: new Date() } }),
      ]);
      return members + invited;
    }
    case 'leads':
      return Lead.countDocuments({ organizationId: org, deletedAt: null });
    case 'properties':
      return Property.countDocuments({ organizationId: org, deletedAt: null });
    case 'deals':
      return Deal.countDocuments({ organizationId: org, deletedAt: null });
  }
}

export interface UsageRow {
  key: LimitKey;
  used: number;
  limit: number | null;
  remaining: number | null;
  atLimit: boolean;
  overLimit: boolean;
}

export async function getOrganizationUsage(organizationId: string): Promise<UsageRow[]> {
  const { limits } = await getOrganizationEntitlements(organizationId);
  return Promise.all(
    LIMIT_KEYS.map(async (key) => {
      const used = await countUsage(organizationId, key);
      const limit = limits[key];
      return {
        key,
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
        atLimit: limit !== null && used >= limit,
        overLimit: limit !== null && used > limit,
      };
    }),
  );
}

export async function checkUsageLimit(organizationId: string, key: LimitKey, adding = 1) {
  const { limits } = await getOrganizationEntitlements(organizationId);
  const limit = limits[key];
  const used = await countUsage(organizationId, key);
  return { allowed: limit === null || used + adding <= limit, used, limit };
}

/* ----------------------------------------------------------------- entitlement errors */

export const featureError = (feature: FeatureKey) =>
  AppError.forbidden(`Your license does not include the "${feature}" feature. Upgrade your license to use it.`, 'FEATURE_NOT_LICENSED');

export const limitError = (key: LimitKey, used: number, limit: number | null) =>
  AppError.forbidden(
    `You have reached your license limit for ${key} (${used} of ${limit}). Upgrade your license or remove some to add more.`,
    'LICENSE_LIMIT_REACHED',
  );

export async function assertFeature(organizationId: string, feature: FeatureKey) {
  if (!(await hasFeature(organizationId, feature))) throw featureError(feature);
}

export async function assertWithinLimit(organizationId: string, key: LimitKey, adding = 1) {
  const r = await checkUsageLimit(organizationId, key, adding);
  if (!r.allowed) throw limitError(key, r.used, r.limit);
}

/* ----------------------------------------------------------------- concurrency */

const LOCK_LEASE_MS = 15_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Short per-(organization, key) mutex in MongoDB, so "check the limit, then create" cannot race, even across several
 * API instances. The lease expires on its own, so a crashed request can never block an organization.
 */
export async function acquireUsageSlot(organizationId: string, key: string, waitMs = 4000): Promise<() => Promise<void>> {
  const owner = randomUUID();
  const org = oid(organizationId);
  const deadline = Date.now() + waitMs;

  for (;;) {
    const now = new Date();
    try {
      const doc = await UsageLock.findOneAndUpdate(
        { organizationId: org, key, lockedUntil: { $lte: now } },
        { $set: { owner, lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS) } },
        { upsert: true, returnDocument: 'after' },
      );
      if (doc?.owner === owner) {
        return () =>
          UsageLock.updateOne({ organizationId: org, key, owner }, { $set: { lockedUntil: new Date(0) } }).then(() => undefined);
      }
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }

    if (Date.now() > deadline) throw AppError.tooManyRequests();
    await sleep(40);
  }
}