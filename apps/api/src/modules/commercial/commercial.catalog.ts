import { z } from 'zod';

export const FEATURE_KEYS = ['analytics', 'advancedReports', 'csvExport', 'automations', 'advancedNotifications', 'apiAccess'] as const;
export const LIMIT_KEYS = ['members', 'leads', 'properties', 'deals', 'automationExecutionsPerMonth', 'storageBytes'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;
/** null = unlimited. A missing limit is treated as 0 (fail closed), never as unlimited. */
export type Limits = Record<LimitKey, number | null>;

export interface Entitlements {
  source: 'SUBSCRIPTION' | 'LICENSE' | 'FALLBACK' | 'RESTRICTED';
  planSlug: string | null;
  planName: string | null;
  status: string;
  features: Features;
  limits: Limits;
  validUntil: Date | null;
}

/**
 * Limit policy (documented, not scattered): every limit is HARD ON CREATE. Reaching a limit blocks CREATING more of that
 * thing. It never deletes, hides or locks existing data. After a downgrade an organization may be above its new limit:
 * it keeps everything and simply cannot add more until it is back under the limit or upgrades.
 */
export const LIMIT_POLICY = 'HARD_ON_CREATE' as const;

const noFeatures = (): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Features;
const zeroLimits = (): Limits => Object.fromEntries(LIMIT_KEYS.map((k) => [k, 0])) as Limits;

/** Used when nothing grants access: data stays readable, nothing new can be created, no paid features. */
export const RESTRICTED_ENTITLEMENTS: Entitlements = {
  source: 'RESTRICTED', planSlug: null, planName: null, status: 'NONE', features: noFeatures(), limits: zeroLimits(), validUntil: null,
};

export const normalizeFeatures = (raw: unknown): Features => {
  const base = noFeatures();
  for (const k of FEATURE_KEYS) base[k] = (raw as Record<string, unknown> | null)?.[k] === true;
  return base;
};
export const normalizeLimits = (raw: unknown): Limits => {
  const out = zeroLimits();
  for (const k of LIMIT_KEYS) {
    const v = (raw as Record<string, unknown> | null)?.[k];
    out[k] = v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
  }
  return out;
};

export const featuresSchema = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>).strict();
export const limitsSchema = z.object(
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()])) as Record<LimitKey, z.ZodNullable<z.ZodNumber>>,
).strict();