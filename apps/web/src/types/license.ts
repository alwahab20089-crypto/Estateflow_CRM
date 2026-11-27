export type LicenseState = 'NONE' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'INACTIVE' | 'REVOKED';
export type LicenseEdition = 'STANDARD' | 'PROFESSIONAL' | 'AGENCY';

export const FEATURE_KEYS = ['analytics', 'csvExport', 'automations', 'advancedNotifications'] as const;
export const LIMIT_KEYS = ['members', 'leads', 'properties', 'deals'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface UsageRow {
  key: LimitKey;
  used: number;
  /** null = unlimited */
  limit: number | null;
  remaining: number | null;
  atLimit: boolean;
  overLimit: boolean;
}

/** GET /licenses/status: readable by every member. */
export interface LicenseStatus {
  state: LicenseState;
  edition: LicenseEdition | null;
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
  validUntil: string | null;
  graceEndsAt: string | null;
  usage: UsageRow[];
}

export interface LicenseDetails {
  licensee: string;
  keyLast4: string;
  issuedAt: string;
  activatedAt: string;
  expiresAt: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
}

/** GET /licenses/current: owner only. */
export interface LicenseOverview extends LicenseStatus {
  /** false when the server has no LICENSE_PUBLIC_KEY, so no key can be activated. */
  configured: boolean;
  license: LicenseDetails | null;
}

export interface SetupStatus {
  setupRequired: boolean;
}