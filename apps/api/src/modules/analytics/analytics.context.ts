import { Types, type PipelineStage } from 'mongoose';
import { AppError } from '../../utils/app-error';
import { OrganizationMember } from '../members/member.model';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { Organization } from '../organizations/organization.model';
import { User } from '../users/user.model';
import { addDays, daysBetween, isValidTimezone, shiftMonths, startOfDayUtc, startOfMonth, startOfWeek, ymdInTz } from './tz';

export const MAX_RANGE_DAYS = 366;
export type GroupBy = 'day' | 'week' | 'month' | 'year';
export type Cond = Record<string, unknown>;
export type Kind = 'leads' | 'deals' | 'properties' | 'tasks';

export interface Range { from: Date; to: Date; fromYmd: string; toYmd: string; days: number } // [from, to) in UTC; ymd are inclusive civil dates
export interface AnalyticsContext {
  tenant: TenantContext;
  userId: string;
  timezone: string;
  orgCurrency: string;
  now: Date;
  range: Range;
  previous: Range;
  groupBy: GroupBy;
  /** analytics:team. Without it every number is restricted to the caller's own records. */
  teamWide: boolean;
  member: Types.ObjectId | 'unassigned' | null;
}

export interface BaseQuery { period: string; from?: string; to?: string; timezone?: string; groupBy?: GroupBy; assignedTo?: string }

export const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));
export const can = (c: AnalyticsContext, p: string) => c.tenant.permissions.includes(p);
export const pipeline = (stages: unknown[]) => stages as unknown as PipelineStage[];
export const exec = async <T>(a: PromiseLike<unknown[]>) => (await a) as T[];

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function makeRange(fromYmd: string, toYmd: string, tz: string): Range {
  return { fromYmd, toYmd, days: daysBetween(fromYmd, toYmd) + 1, from: startOfDayUtc(fromYmd, tz), to: startOfDayUtc(addDays(toYmd, 1), tz) };
}

export async function buildContext(tenant: TenantContext, userId: string, q: BaseQuery, now = new Date()): Promise<AnalyticsContext> {
  const org = (await Organization.findById(tenant.organizationId).select('timezone currency').lean()) as { timezone?: string; currency?: string } | null;
  const timezone = q.timezone ?? (org?.timezone && isValidTimezone(org.timezone) ? org.timezone : 'UTC');
  const today = ymdInTz(now, timezone);

  let fromYmd: string;
  let toYmd: string;
  if (q.period === 'custom') {
    if (!q.from || !q.to) throw AppError.validation([{ path: 'from', message: 'from and to are required for a custom range' }]);
    fromYmd = q.from;
    toYmd = q.to;
  } else {
    toYmd = today;
    fromYmd = q.period === '12m' ? addDays(shiftMonths(today, -12), 1) : addDays(today, -(PERIOD_DAYS[q.period]! - 1));
  }
  const days = daysBetween(fromYmd, toYmd) + 1;
  if (days < 1) throw AppError.validation([{ path: 'to', message: '"to" must not be before "from"' }]);
  if (days > MAX_RANGE_DAYS) throw AppError.validation([{ path: 'to', message: `The range may not exceed ${MAX_RANGE_DAYS} days` }]);

  const range = makeRange(fromYmd, toYmd, timezone);
  const previous = makeRange(addDays(fromYmd, -days), addDays(fromYmd, -1), timezone);
  const groupBy: GroupBy = q.groupBy ?? (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');

  const teamWide = tenant.permissions.includes('analytics:team');
  let member: AnalyticsContext['member'] = null;
  if (!teamWide) {
    if (q.assignedTo && q.assignedTo !== 'me' && q.assignedTo !== userId) throw AppError.forbidden('You can only view your own analytics');
    member = oid(userId);
  } else if (q.assignedTo === 'me') {
    member = oid(userId);
  } else if (q.assignedTo === 'unassigned') {
    member = 'unassigned';
  } else if (q.assignedTo) {
    await assertActiveMember(tenant.organizationId, q.assignedTo); // another organization's user id -> 422
    member = oid(q.assignedTo);
  }

  return { tenant, userId, timezone, orgCurrency: org?.currency ?? 'USD', now, range, previous, groupBy, teamWide, member };
}

export const rangeMeta = (c: AnalyticsContext) => ({
  range: { from: c.range.fromYmd, to: c.range.toYmd, days: c.range.days },
  previousRange: { from: c.previous.fromYmd, to: c.previous.toYmd, days: c.previous.days },
  timezone: c.timezone,
  groupBy: c.groupBy,
  currency: c.orgCurrency,
  scope: c.teamWide ? 'organization' : 'self',
  generatedAt: c.now.toISOString(),
});

/* ------------------------------------------------------------------ scoping */

export const inRange = (field: string, r: Range): Cond => ({ [field]: { $gte: r.from, $lt: r.to } });

/**
 * Every query starts here: organization + not archived + the caller's visibility (the same read_all rules the CRUD
 * modules use) + the member filter (forced to "me" without analytics:team) + extra conditions.
 */
export function scoped(c: AnalyticsContext, kind: Kind, ...conds: Cond[]): Record<string, unknown> {
  const uid = oid(c.userId);
  const and: Cond[] = [];
  if (kind === 'leads' && !can(c, 'leads:read_all')) and.push({ assignedTo: uid });
  if (kind === 'deals' && !can(c, 'deals:read_all')) and.push({ $or: [{ assignedTo: uid }, { createdBy: uid }] });
  if (kind === 'tasks' && !can(c, 'tasks:read_all')) and.push({ $or: [{ assignedTo: uid }, { createdBy: uid }] });
  if (c.member === 'unassigned') and.push({ assignedTo: null });
  else if (c.member) and.push({ assignedTo: c.member });
  and.push(...conds);
  const base: Record<string, unknown> = { organizationId: oid(c.tenant.organizationId), deletedAt: null };
  return and.length ? { ...base, $and: and } : base;
}

/* ------------------------------------------------------------ small helpers */

export const round1 = (n: number) => Math.round(n * 10) / 10;
/** Percentage with one decimal, or null when the denominator is 0 (never a misleading 0% or Infinity). */
export const rate = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);
export const flag = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });

export interface CurrencyAmount { currency: string; count: number; amount: number }
export const toCurrencyAmounts = (rows: Array<{ _id: string; count: number; amount: number }>): CurrencyAmount[] =>
  rows.map((r) => ({ currency: r._id, count: r.count, amount: Math.round(r.amount) })).sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
export const amountIn = (list: CurrencyAmount[], currency: string) => list.find((x) => x.currency === currency)?.amount ?? 0;

export interface Comparison {
  previous: number | null;
  changePct: number | null;
  changePoints: number | null;
  /** 'new' = previous period was 0 (no meaningful percentage). 'unknown' = one side cannot be computed. */
  direction: 'up' | 'down' | 'flat' | 'new' | 'unknown';
}
export function compare(cur: number | null, prev: number | null, kind: 'percent' | 'points' = 'percent'): Comparison {
  if (cur === null || prev === null) return { previous: prev, changePct: null, changePoints: null, direction: 'unknown' };
  const delta = cur - prev;
  const direction = delta === 0 ? 'flat' : prev === 0 ? 'new' : delta > 0 ? 'up' : 'down';
  return {
    previous: prev,
    changePct: kind === 'percent' && prev > 0 ? round1((delta / prev) * 100) : null,
    changePoints: kind === 'points' ? round1(delta) : null,
    direction,
  };
}

export function distribution(rows: Array<{ _id: unknown; count: number }>, total: number, order?: readonly string[]) {
  const m = new Map(rows.map((r) => [String(r._id ?? 'UNKNOWN'), r.count]));
  const keys = order
    ? [...order, ...[...m.keys()].filter((k) => !order.includes(k))]
    : [...m.keys()].sort((a, b) => m.get(b)! - m.get(a)! || a.localeCompare(b));
  return keys.map((key) => ({ key, count: m.get(key) ?? 0, share: total > 0 ? round1(((m.get(key) ?? 0) / total) * 100) : 0 }));
}

/* ---------------------------------------------------------------- assignees */

/** Names are only resolved for CURRENT members of this organization. Everyone else is "Former member". */
export async function resolveAssignees(c: AnalyticsContext, ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map<string, { name: string; isMember: boolean }>();
  if (unique.length === 0) return out;
  const [members, users] = await Promise.all([
    OrganizationMember.find({ organizationId: c.tenant.organizationId, userId: { $in: unique }, status: 'ACTIVE', invitationStatus: 'ACCEPTED' }).select('userId').lean(),
    User.find({ _id: { $in: unique } }).select('name').lean(),
  ]);
  const memberSet = new Set(members.map((m) => String(m.userId)));
  const names = new Map(users.map((u) => [String(u._id), u.name as string]));
  for (const id of unique) out.set(id, { name: memberSet.has(id) ? (names.get(id) ?? 'Member') : 'Former member', isMember: memberSet.has(id) });
  return out;
}
export const assigneeLabel = (m: Map<string, { name: string }>, id: unknown) => (id ? (m.get(String(id))?.name ?? 'Former member') : 'Unassigned');

/* ------------------------------------------------------------------- series */

export interface SeriesPoint { bucket: string; value: number; count?: number; byCurrency?: Record<string, number> }
export interface Series { key: string; label: string; unit: 'count' | 'money'; points: SeriesPoint[] }

/** Bucket start as a civil date in the report timezone. Weeks start on Monday. */
export const bucketExpr = (field: string, c: AnalyticsContext) => ({
  $dateToString: {
    format: '%Y-%m-%d',
    timezone: c.timezone,
    date: { $dateTrunc: { date: field, unit: c.groupBy, timezone: c.timezone, ...(c.groupBy === 'week' ? { startOfWeek: 'monday' } : {}) } },
  },
});

export function bucketKeys(c: AnalyticsContext): string[] {
  const keys: string[] = [];
  let cur =
    c.groupBy === 'day' ? c.range.fromYmd : c.groupBy === 'week' ? startOfWeek(c.range.fromYmd) : c.groupBy === 'month' ? startOfMonth(c.range.fromYmd) : `${c.range.fromYmd.slice(0, 4)}-01-01`;
  for (let i = 0; i < 1000 && cur <= c.range.toYmd; i += 1) {
    keys.push(cur);
    cur = c.groupBy === 'day' ? addDays(cur, 1) : c.groupBy === 'week' ? addDays(cur, 7) : c.groupBy === 'month' ? shiftMonths(cur, 1) : shiftMonths(cur, 12);
  }
  return keys;
}

/** Continuous series: buckets with no records are returned as 0 so charts never skip periods. */
export function countSeries(c: AnalyticsContext, key: string, label: string, rows: Array<{ _id: string; count: number }>): Series {
  const m = new Map(rows.map((r) => [r._id, r.count]));
  return { key, label, unit: 'count', points: bucketKeys(c).map((b) => ({ bucket: b, value: m.get(b) ?? 0 })) };
}

export function moneySeries(c: AnalyticsContext, key: string, label: string, rows: Array<{ _id: { b: string; c: string }; count: number; amount: number }>): Series {
  const m = new Map<string, { count: number; byCurrency: Record<string, number> }>();
  for (const r of rows) {
    const cur = m.get(r._id.b) ?? { count: 0, byCurrency: {} };
    cur.count += r.count;
    cur.byCurrency[r._id.c] = (cur.byCurrency[r._id.c] ?? 0) + Math.round(r.amount);
    m.set(r._id.b, cur);
  }
  return {
    key, label, unit: 'money',
    points: bucketKeys(c).map((b) => ({ bucket: b, value: m.get(b)?.byCurrency[c.orgCurrency] ?? 0, count: m.get(b)?.count ?? 0, byCurrency: m.get(b)?.byCurrency ?? {} })),
  };
}