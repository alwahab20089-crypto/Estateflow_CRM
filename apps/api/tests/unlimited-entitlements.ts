import { LIMIT_KEYS, FEATURE_KEYS, type Entitlements } from '../src/modules/licensing/license.catalog';

/**
 * Entitlements used by every test file EXCEPT licensing.test.ts, so ordinary CRM tests are not affected by license limits.
 * licensing.test.ts switches back to the real license source.
 */
export const UNLIMITED_ENTITLEMENTS: Entitlements = {
  source: 'LICENSE',
  edition: 'AGENCY',
  state: 'ACTIVE',
  features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Entitlements['features'],
  limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, null])) as Entitlements['limits'],
  validUntil: null,
  graceEndsAt: null,
};