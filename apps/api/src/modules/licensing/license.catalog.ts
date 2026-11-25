import { z } from 'zod';
import type { LicenseEdition } from '../../constants';

/** Features a license can switch on. Each one is enforced on the server (routes or services), never only in the UI. */
export const FEATURE_KEYS = ['analytics', 'csvExport', 'automations', 'advancedNotifications'] as const;
/** Counted limits. Every limit is enforced when something is CREATED. */
export const LIMIT_KEYS = ['members', 'leads', 'properties', 'deals'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;
/** null = unlimited. A missing limit is treated as 0 (fail closed), never as unlimited. */
export type Limits = Record<LimitKey, number | null>;

export type LicenseState = 'NONE' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'INACTIVE' | 'REVOKED';

export interface Entitlements {
  /** LICENSE: a valid license grants these. RESTRICTED: nothing grants access (no license, expired, deactivated). */
  source: 'LICENSE' | 'RESTRICTED';
  edition: LicenseEdition | null;
  /** For display and diagnostics. GRACE means the license has ended but is still inside the grace period. */
  state: LicenseState;
  features: Features;
  limits: Limits;
  /** The license end date (null = perpetual or no license). */
  validUntil: Date | null;
  /** Last day the install keeps working after validUntil. Only set while the license has an end date. */
  graceEndsAt: Date | null;
}

/**
 * Limit policy (documented, not scattered): every limit is HARD ON CREATE. Reaching a limit blocks CREATING more of that
 * thing. It never deletes, hides or locks existing data. After a downgrade or an expired license an install may be above
 * its limit: it keeps everything and simply cannot add more until it is back under the limit or the license is renewed.
 */
export const LIMIT_POLICY = 'HARD_ON_CREATE' as const;

const noFeatures = (): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Features;
const zeroLimits = (): Limits => Object.fromEntries(LIMIT_KEYS.map((k) => [k, 0])) as Limits;

/**
 * Used when no valid license grants access: data stays readable, nothing new can be created, no licensed features.
 * This is also what an install gets BEFORE a license is activated. To give unlicensed installs small starter limits
 * instead, change this object.
 */
export const RESTRICTED_ENTITLEMENTS: Entitlements = {
  source: 'RESTRICTED', edition: null, state: 'NONE', features: noFeatures(), limits: zeroLimits(), validUntil: null, graceEndsAt: null,
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

export const featuresSchema = z
  .object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>)
  .strict();
export const limitsSchema = z
  .object(
    Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()])) as Record<
      LimitKey,
      z.ZodNullable<z.ZodNumber>
    >,
  )
  .strict();

/**
 * Starting points for the license tool (scripts/license-tool.ts). PLACEHOLDER numbers: decide your real editions before
 * you sell licenses. Existing licenses are not affected when you change these, because a license carries its own copy.
 */
export const EDITION_PRESETS: Record<LicenseEdition, { features: Features; limits: Limits }> = {
  STANDARD: {
    features: { analytics: false, csvExport: false, automations: false, advancedNotifications: false },
    limits: { members: 3, leads: 500, properties: 250, deals: 100 },
  },
  PROFESSIONAL: {
    features: { analytics: true, csvExport: true, automations: true, advancedNotifications: true },
    limits: { members: 15, leads: 5000, properties: 2500, deals: 2000 },
  },
  AGENCY: {
    features: { analytics: true, csvExport: true, automations: true, advancedNotifications: true },
    limits: { members: null, leads: null, properties: null, deals: null },
  },
};