import { describe, expect, it } from 'vitest';
import type { LicenseStatus, UsageRow } from '@/types/license';
import { bannerFor, createBlockReason, daysUntil, featureBlockReason, isRestricted } from './license-utils';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const row = (over: Partial<UsageRow> = {}): UsageRow => ({ key: 'leads', used: 10, limit: 100, remaining: 90, atLimit: false, overLimit: false, ...over });

const status = (over: Partial<LicenseStatus> = {}): LicenseStatus => ({
  state: 'ACTIVE',
  edition: 'PROFESSIONAL',
  features: { analytics: true, csvExport: true, automations: true, advancedNotifications: true },
  limits: { members: 15, leads: 100, properties: 100, deals: 100 },
  validUntil: day(200),
  graceEndsAt: day(214),
  usage: [row()],
  ...over,
});

describe('daysUntil', () => {
  it('rounds up and goes negative after the date', () => {
    expect(daysUntil(day(3), NOW)).toBe(3);
    expect(daysUntil(new Date(NOW.getTime() + 3.2 * 86_400_000).toISOString(), NOW)).toBe(4);
    expect(daysUntil(day(-2), NOW)).toBe(-2);
  });
});

describe('isRestricted', () => {
  it('is true for every state except ACTIVE and GRACE', () => {
    expect(['ACTIVE', 'GRACE'].map((s) => isRestricted(s as never))).toEqual([false, false]);
    expect(['NONE', 'EXPIRED', 'INACTIVE', 'REVOKED'].every((s) => isRestricted(s as never))).toBe(true);
  });
});

describe('bannerFor', () => {
  it('shows nothing before the status is known or while the license is healthy', () => {
    expect(bannerFor(undefined, true, NOW)).toBeNull();
    expect(bannerFor(status(), true, NOW)).toBeNull();
    expect(bannerFor(status({ validUntil: null, graceEndsAt: null }), true, NOW)).toBeNull();
  });

  it('warns only the owner when the end date is close', () => {
    const soon = status({ validUntil: day(5) });
    expect(bannerFor(soon, true, NOW)).toMatchObject({ tone: 'info', title: 'Your license ends in 5 days', showManageLink: true });
    expect(bannerFor(soon, false, NOW)).toBeNull();
    expect(bannerFor(status({ validUntil: day(1) }), true, NOW)?.title).toBe('Your license ends in 1 day');
  });

  it('warns everyone during the grace period and names the last day', () => {
    const grace = status({ state: 'GRACE', validUntil: day(-3), graceEndsAt: day(11) });
    const owner = bannerFor(grace, true, NOW, (iso) => `on ${iso.slice(0, 10)}`);
    expect(owner).toMatchObject({ tone: 'warning', showManageLink: true });
    expect(owner?.message).toContain(`on ${day(11).slice(0, 10)}`);
    expect(bannerFor(grace, false, NOW)).toMatchObject({ tone: 'warning', showManageLink: false });
  });

  it.each(['EXPIRED', 'INACTIVE', 'REVOKED'] as const)('says %s is read-only, and only the owner gets the link', (state) => {
    expect(bannerFor(status({ state }), false, NOW)).toMatchObject({ tone: 'destructive', showManageLink: false });
    expect(bannerFor(status({ state }), true, NOW)).toMatchObject({ tone: 'destructive', showManageLink: true });
  });

  it('tells the owner to activate, and members to ask the owner, when there is no license', () => {
    expect(bannerFor(status({ state: 'NONE' }), true, NOW)?.title).toBe('Activate your license to get started');
    const member = bannerFor(status({ state: 'NONE' }), false, NOW);
    expect(member?.title).toBe('This workspace is not licensed yet');
    expect(member?.showManageLink).toBe(false);
  });
});

describe('createBlockReason', () => {
  it('never blocks while the status is unknown: the server decides', () => {
    expect(createBlockReason(undefined, 'leads')).toBeNull();
  });

  it('blocks everything when restricted', () => {
    expect(createBlockReason(status({ state: 'NONE' }), 'leads')).toMatch(/no license yet/);
    expect(createBlockReason(status({ state: 'EXPIRED' }), 'deals')).toMatch(/not active/);
  });

  it('blocks only the resource that is at its limit', () => {
    const s = status({ usage: [row({ key: 'leads', used: 100, atLimit: true, remaining: 0 }), row({ key: 'deals', used: 1 })] });
    expect(createBlockReason(s, 'leads')).toMatch(/limit of 100 leads/);
    expect(createBlockReason(s, 'deals')).toBeNull();
  });

  it('does not block an unlimited resource', () => {
    const s = status({ usage: [row({ limit: null, remaining: null })] });
    expect(createBlockReason(s, 'leads')).toBeNull();
  });
});

describe('featureBlockReason', () => {
  it('is null when the feature is included or the status is unknown', () => {
    expect(featureBlockReason(undefined, 'analytics')).toBeNull();
    expect(featureBlockReason(status(), 'analytics')).toBeNull();
  });

  it('explains a feature the edition leaves out', () => {
    const s = status({ features: { analytics: false, csvExport: true, automations: true, advancedNotifications: true } });
    expect(featureBlockReason(s, 'analytics')).toMatch(/not included in your license/);
  });

  it('asks for an active license when restricted', () => {
    const s = status({ state: 'EXPIRED', features: { analytics: false, csvExport: false, automations: false, advancedNotifications: false } });
    expect(featureBlockReason(s, 'csvExport')).toMatch(/needs an active license/);
  });
});