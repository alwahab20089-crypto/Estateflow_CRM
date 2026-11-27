import type { FeatureKey, LicenseState, LicenseStatus, LimitKey } from '@/types/license';

export const DAY_MS = 86_400_000;
/** The owner is warned this many days before a license ends. */
export const EXPIRY_WARNING_DAYS = 14;

export const stateLabels: Record<LicenseState, string> = {
  NONE: 'Not activated',
  ACTIVE: 'Active',
  GRACE: 'Expired, grace period',
  EXPIRED: 'Expired',
  INACTIVE: 'Deactivated',
  REVOKED: 'Revoked',
};

export const featureLabels: Record<FeatureKey, { label: string; description: string }> = {
  analytics: { label: 'Analytics', description: 'Performance dashboards for leads, deals, properties, team and tasks.' },
  csvExport: { label: 'CSV export', description: 'Download report results as CSV files.' },
  automations: { label: 'Automations', description: 'Create and run workflows that react to changes in your CRM.' },
  advancedNotifications: { label: 'Advanced notifications', description: 'Automation actions that send email.' },
};

export const limitLabels: Record<LimitKey, { singular: string; plural: string }> = {
  members: { singular: 'team member', plural: 'team members' },
  leads: { singular: 'lead', plural: 'leads' },
  properties: { singular: 'property', plural: 'properties' },
  deals: { singular: 'deal', plural: 'deals' },
};

/** Restricted: everything stays readable, nothing new can be created, licensed features are off. */
export const isRestricted = (state: LicenseState) => state !== 'ACTIVE' && state !== 'GRACE';

/** Whole days from now until the date, rounded up. Negative once it has passed. */
export const daysUntil = (iso: string, now = new Date()) => Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS);

export const formatLimit = (limit: number | null) => (limit === null ? 'Unlimited' : limit.toLocaleString('en-US'));

/** Why an "Add" action is blocked, or null when it is allowed. Unknown status never blocks: the server decides. */
export function createBlockReason(status: LicenseStatus | undefined, key: LimitKey): string | null {
  if (!status) return null;
  if (isRestricted(status.state)) {
    return status.state === 'NONE'
      ? 'This workspace has no license yet. A license is required to add records.'
      : 'Your license is not active. A license is required to add records.';
  }
  const row = status.usage.find((u) => u.key === key);
  if (!row?.atLimit) return null;
  return `You have reached your license limit of ${formatLimit(row.limit)} ${limitLabels[key].plural}. Upgrade your license to add more.`;
}

export function featureBlockReason(status: LicenseStatus | undefined, feature: FeatureKey): string | null {
  if (!status || status.features[feature] === true) return null;
  const { label } = featureLabels[feature];
  return isRestricted(status.state)
    ? `${label} needs an active license.`
    : `${label} is not included in your license. Upgrade your license to use it.`;
}

export interface BannerContent {
  tone: 'info' | 'warning' | 'destructive';
  title: string;
  message: string;
  /** Offered only to the owner, who can act on it. */
  showManageLink: boolean;
}

/**
 * What the app-wide banner says, or null for nothing. Pure so it can be tested without rendering.
 * Members see what is wrong; only the owner (license:manage) is told to act and gets the link.
 */
export function bannerFor(status: LicenseStatus | undefined, canManage: boolean, now = new Date(), dateText = (iso: string) => iso): BannerContent | null {
  if (!status) return null;
  const owner = canManage;

  switch (status.state) {
    case 'ACTIVE': {
      if (!owner || !status.validUntil) return null;
      const left = daysUntil(status.validUntil, now);
      if (left > EXPIRY_WARNING_DAYS) return null;
      return {
        tone: 'info',
        title: `Your license ends in ${left} ${left === 1 ? 'day' : 'days'}`,
        message: `It runs until ${dateText(status.validUntil)}. Renew it before then so nothing is interrupted.`,
        showManageLink: true,
      };
    }
    case 'GRACE':
      return {
        tone: 'warning',
        title: 'Your license has expired',
        message: status.graceEndsAt
          ? `Everything keeps working until ${dateText(status.graceEndsAt)}. After that you can still view your data, but not add new records.`
          : 'Everything keeps working for a short grace period.',
        showManageLink: owner,
      };
    case 'EXPIRED':
      return {
        tone: 'destructive',
        title: 'Your license has expired',
        message: 'You can still view all your data, but adding new records and licensed features are turned off.',
        showManageLink: owner,
      };
    case 'INACTIVE':
      return {
        tone: 'destructive',
        title: 'The license is deactivated',
        message: 'You can still view all your data, but adding new records and licensed features are turned off.',
        showManageLink: owner,
      };
    case 'REVOKED':
      return {
        tone: 'destructive',
        title: 'The license was revoked',
        message: 'You can still view all your data, but adding new records and licensed features are turned off.',
        showManageLink: owner,
      };
    case 'NONE':
      return {
        tone: 'info',
        title: owner ? 'Activate your license to get started' : 'This workspace is not licensed yet',
        message: owner
          ? 'Paste the license key you received to start adding leads, properties and deals.'
          : 'Ask the workspace owner to activate the license. Until then you can view data but not add new records.',
        showManageLink: owner,
      };
  }
}