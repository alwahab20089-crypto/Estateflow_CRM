// src/modules/commercial/plans.seed.ts
import type { FeatureKey, LimitKey } from './commercial.catalog';

/**
 * EXAMPLE plans only. Prices and limits are placeholders: edit before launch. Provider variant ids are NOT here;
 * they come from the provider dashboard and are set through plan management (next part).
 */
export const EXAMPLE_PLANS: {
  name: string; slug: string; description: string; isFallback?: boolean; sortOrder: number; trialDays: number;
  prices: { interval: 'MONTH' | 'YEAR'; amount: number; currency: string }[];
  features: Record<FeatureKey, boolean>; limits: Record<LimitKey, number | null>;
}[] = [
  {
    name: 'Free', slug: 'free', description: 'Get started with the essentials.', isFallback: true, sortOrder: 0, trialDays: 0, prices: [],
    features: { analytics: false, advancedReports: false, csvExport: false, automations: false, advancedNotifications: false, apiAccess: false },
    limits: { members: 2, leads: 50, properties: 25, deals: 10, automationExecutionsPerMonth: 0, storageBytes: 100 * 1024 * 1024 },
  },
  {
    name: 'Professional', slug: 'professional', description: 'For growing agencies.', sortOrder: 1, trialDays: 14,
    prices: [{ interval: 'MONTH', amount: 4900, currency: 'USD' }, { interval: 'YEAR', amount: 49000, currency: 'USD' }],
    features: { analytics: true, advancedReports: true, csvExport: true, automations: true, advancedNotifications: true, apiAccess: false },
    limits: { members: 10, leads: 2000, properties: 1000, deals: 500, automationExecutionsPerMonth: 5000, storageBytes: 5 * 1024 ** 3 },
  },
  {
    name: 'Business', slug: 'business', description: 'No practical limits for large teams.', sortOrder: 2, trialDays: 14,
    prices: [{ interval: 'MONTH', amount: 14900, currency: 'USD' }, { interval: 'YEAR', amount: 149000, currency: 'USD' }],
    features: { analytics: true, advancedReports: true, csvExport: true, automations: true, advancedNotifications: true, apiAccess: false },
    limits: { members: null, leads: null, properties: null, deals: null, automationExecutionsPerMonth: 50_000, storageBytes: 50 * 1024 ** 3 },
  },
];