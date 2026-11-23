
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { OPEN_LEAD_STATUSES, type SubscriptionStatus } from '../../constants';
import { AppError } from '../../utils/app-error';
import { Deal } from '../deals/deal.model';
import { Lead } from '../leads/lead.model';
import { OrganizationMember } from '../members/member.model';
import { Property } from '../properties/property.model';
import {
    FEATURE_KEYS,
    LIMIT_KEYS,
    RESTRICTED_ENTITLEMENTS,
    normalizeFeatures,
    normalizeLimits,
    type Entitlements,
    type FeatureKey,
    type LimitKey,
} from './commercial.catalog';
import {
    Plan,
    Subscription,
    UsageCounter,
    UsageLock,
    type SubscriptionRecord,
} from './commercial.model';

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));

/* ----------------------------------------------------------------- edition sources */

type Source = (organizationId: string) => Promise<Entitlements>;

const sources: Partial<Record<string, Source>> = {};

/** The self-hosted (license-backed) source registers itself here, so CRM modules never branch on the edition. */
export const registerEntitlementSource = (
    mode: 'SAAS' | 'SELF_HOSTED',
    source: Source,
) => {
    sources[mode] = source;
};

/** CANCELLED keeps access until the paid period ends; PAST_DUE keeps it during the provider's retry window. */
export function isEntitling(
    sub: Pick<SubscriptionRecord, 'status' | 'currentPeriodEnd'>,
    now = new Date(),
) {
    const s = sub.status as SubscriptionStatus;

    if (s === 'TRIALING' || s === 'ACTIVE' || s === 'PAST_DUE') {
        return true;
    }

    if (s === 'CANCELLED') {
        return Boolean(
            sub.currentPeriodEnd &&
            sub.currentPeriodEnd.getTime() > now.getTime(),
        );
    }

    return false;
}

const cache = new Map<string, { at: number; value: Entitlements }>();
const TTL_MS = env.NODE_ENV === 'test' ? 0 : 15_000;

export const invalidateEntitlements = (organizationId?: string) =>
    organizationId ? cache.delete(organizationId) : cache.clear();

async function saasSource(organizationId: string): Promise<Entitlements> {
    const now = new Date();

    const candidates = await Subscription.find({
        organizationId: oid(organizationId),
        status: { $in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] },
    })
        .sort({ createdAt: -1 })
        .lean();

    const active = candidates.find((s) => isEntitling(s, now));

    if (active) {
        const plan = await Plan.findById(active.planId).lean();

        if (plan) {
            return {
                source: 'SUBSCRIPTION',
                planSlug: plan.slug,
                planName: plan.name,
                status: active.status,
                features: normalizeFeatures(plan.features),
                limits: normalizeLimits(plan.limits),
                validUntil: active.currentPeriodEnd ?? null,
            };
        }
    }

    const fallback = await Plan.findOne({
        isFallback: true,
        isActive: true,
    }).lean();

    if (fallback) {
        return {
            source: 'FALLBACK',
            planSlug: fallback.slug,
            planName: fallback.name,
            status: 'NONE',
            features: normalizeFeatures(fallback.features),
            limits: normalizeLimits(fallback.limits),
            validUntil: null,
        };
    }

    return RESTRICTED_ENTITLEMENTS;
}

registerEntitlementSource('SAAS', saasSource);

/** The single entry point. Resolved on the server from persisted state only: no request value is ever consulted. */
export async function getOrganizationEntitlements(
    organizationId: string,
): Promise<Entitlements> {
    const hit = cache.get(organizationId);

    if (hit && Date.now() - hit.at < TTL_MS) {
        return hit.value;
    }

    const source = sources[env.DEPLOYMENT_MODE];
    const value = source
        ? await source(organizationId)
        : RESTRICTED_ENTITLEMENTS;

    cache.set(organizationId, { at: Date.now(), value });

    return value;
}

export async function hasFeature(
    organizationId: string,
    feature: FeatureKey,
) {
    return (
        (await getOrganizationEntitlements(organizationId)).features[feature] ===
        true
    );
}

/* ----------------------------------------------------------------- usage (always derived from the source records) */

const utcPeriod = (d = new Date()) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * "Active" definitions (deleted/archived records never count):
 *  members: ACTIVE + ACCEPTED memberships · leads: open statuses · properties: not sold/rented/leased/inactive
 *  deals: not WON/LOST · storage: sum of stored property image sizes (archived properties still occupy storage)
 *  automation executions: counter for the current UTC calendar month. It resets automatically because the period is
 *  part of the counter key; old months are kept as history.
 */
export async function countUsage(
    organizationId: string,
    key: LimitKey,
): Promise<number> {
    const org = oid(organizationId);

    switch (key) {
        case 'members':
            return OrganizationMember.countDocuments({
                organizationId: org,
                status: 'ACTIVE',
                invitationStatus: 'ACCEPTED',
            });

        case 'leads':
            return Lead.countDocuments({
                organizationId: org,
                deletedAt: null,
                status: { $in: [...OPEN_LEAD_STATUSES] },
            });

        case 'properties':
            return Property.countDocuments({
                organizationId: org,
                deletedAt: null,
                propertyStatus: {
                    $nin: ['SOLD', 'RENTED', 'LEASED', 'INACTIVE'],
                },
            });

        case 'deals':
            return Deal.countDocuments({
                organizationId: org,
                deletedAt: null,
                stage: { $nin: ['WON', 'LOST'] },
            });

        case 'automationExecutionsPerMonth':
            return (
                (await UsageCounter.findOne({
                    organizationId: org,
                    key,
                    periodKey: utcPeriod(),
                }).lean())?.count ?? 0
            );

        case 'storageBytes': {
            // NOTE: assumes each stored image keeps a numeric `size` (bytes). Verify against your property image schema.
            const [row] = await Property.aggregate([
                { $match: { organizationId: org } },
                { $unwind: '$images' },
                {
                    $group: {
                        _id: null,
                        bytes: {
                            $sum: {
                                $ifNull: ['$images.size', 0],
                            },
                        },
                    },
                },
            ]);

            return row?.bytes ?? 0;
        }
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

export async function getOrganizationUsage(
    organizationId: string,
): Promise<UsageRow[]> {
    const { limits } = await getOrganizationEntitlements(organizationId);

    return Promise.all(
        LIMIT_KEYS.map(async (key) => {
            const used = await countUsage(organizationId, key);
            const limit = limits[key];

            return {
                key,
                used,
                limit,
                remaining:
                    limit === null ? null : Math.max(0, limit - used),
                atLimit: limit !== null && used >= limit,
                overLimit: limit !== null && used > limit,
            };
        }),
    );
}

export async function checkUsageLimit(
    organizationId: string,
    key: LimitKey,
    adding = 1,
) {
    const { limits } = await getOrganizationEntitlements(organizationId);
    const limit = limits[key];
    const used = await countUsage(organizationId, key);

    return {
        allowed: limit === null || used + adding <= limit,
        used,
        limit,
    };
}

/* ----------------------------------------------------------------- entitlement errors */

/**
 * AppError.forbidden accepts only message and error code.
 * Keep feature information in the message instead of passing unsupported metadata.
 */
export const featureError = (feature: FeatureKey) =>
    AppError.forbidden(
        `Your current plan does not include the "${feature}" feature. Upgrade to use it.`,
        'FEATURE_NOT_AVAILABLE',
    );

export const limitError = (
    key: LimitKey,
    used: number,
    limit: number | null,
) =>
    AppError.forbidden(
        `You have reached your plan limit for ${key} (${used} of ${limit}). Upgrade your plan or free up space to add more.`,
        'PLAN_LIMIT_REACHED',
    );

export async function assertFeature(
    organizationId: string,
    feature: FeatureKey,
) {
    if (!(await hasFeature(organizationId, feature))) {
        throw featureError(feature);
    }
}

export async function assertWithinLimit(
    organizationId: string,
    key: LimitKey,
    adding = 1,
) {
    const r = await checkUsageLimit(organizationId, key, adding);

    if (!r.allowed) {
        throw limitError(key, r.used, r.limit);
    }
}

/* ----------------------------------------------------------------- concurrency */

const LOCK_LEASE_MS = 15_000;

const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Short per-(organization, key) mutex in MongoDB, so "check the limit, then create" cannot race, even across several
 * API instances and even when real transactions hide uncommitted rows from each other. The lease expires on its own,
 * so a crashed request can never block an organization.
 */
export async function acquireUsageSlot(
    organizationId: string,
    key: string,
    waitMs = 4000,
): Promise<() => Promise<void>> {
    const owner = randomUUID();
    const org = oid(organizationId);
    const deadline = Date.now() + waitMs;

    for (; ;) {
        const now = new Date();

        try {
            const doc = await UsageLock.findOneAndUpdate(
                {
                    organizationId: org,
                    key,
                    lockedUntil: { $lte: now },
                },
                {
                    $set: {
                        owner,
                        lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS),
                    },
                },
                {
                    upsert: true,
                    returnDocument: 'after',
                },
            );

            if (doc?.owner === owner) {
                return () =>
                    UsageLock.updateOne(
                        { organizationId: org, key, owner },
                        { $set: { lockedUntil: new Date(0) } },
                    ).then(() => undefined);
            }
        } catch (err) {
            if ((err as { code?: number }).code !== 11000) {
                throw err;
            }
        }

        if (Date.now() > deadline) {
            throw AppError.tooManyRequests();
        }

        await sleep(40);
    }
}

/** Exact, atomic monthly counter (no read-then-write). Returns false when the limit is already used up. */
export async function reserveAutomationExecution(
    organizationId: string,
): Promise<boolean> {
    const { limits } = await getOrganizationEntitlements(organizationId);
    const limit = limits.automationExecutionsPerMonth;

    if (limit === 0) {
        return false;
    }

    const filter = {
        organizationId: oid(organizationId),
        key: 'automationExecutionsPerMonth',
        periodKey: utcPeriod(),
        ...(limit === null ? {} : { count: { $lt: limit } }),
    };

    try {
        return Boolean(
            await UsageCounter.findOneAndUpdate(
                filter,
                { $inc: { count: 1 } },
                { upsert: true, returnDocument: 'after' },
            ),
        );
    } catch (err) {
        if ((err as { code?: number }).code === 11000) {
            return false;
        }

        throw err;
    }
}

export const releaseAutomationExecution = (organizationId: string) =>
    UsageCounter.updateOne(
        {
            organizationId: oid(organizationId),
            key: 'automationExecutionsPerMonth',
            periodKey: utcPeriod(),
            count: { $gt: 0 },
        },
        { $inc: { count: -1 } },
    ).then(() => undefined);

export { FEATURE_KEYS };
