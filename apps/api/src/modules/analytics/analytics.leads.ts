import { LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STATUSES, LEAD_TYPES } from '../../constants';
import { Lead } from '../leads/lead.model';
import {
  assigneeLabel, bucketExpr, compare, countSeries, distribution, exec, flag, inRange, pipeline, rate, resolveAssignees, round1, scoped,
  type AnalyticsContext, type Cond, type Range, type Series,
} from './analytics.context';

/** Leads that have reached at least QUALIFIED and are not lost. There is no status history, so a lead that was qualified and later LOST is not counted. */
export const QUALIFIED_STATUSES = ['QUALIFIED', 'MEETING_SCHEDULED', 'NEGOTIATION', 'WON'];
export interface LeadFilters { leadSource?: string; status?: string }

const conds = (f: LeadFilters): Cond[] => [...(f.leadSource ? [{ leadSource: f.leadSource }] : []), ...(f.status ? [{ status: f.status }] : [])];
const isConverted = { $eq: [{ $type: '$convertedAt' }, 'date'] };
export const leadTotalsGroup = {
  total: { $sum: 1 },
  qualified: flag({ $in: ['$status', QUALIFIED_STATUSES] }),
  converted: flag(isConverted),
  won: flag({ $eq: ['$status', 'WON'] }),
  lost: flag({ $eq: ['$status', 'LOST'] }),
};

interface Totals { total: number; qualified: number; converted: number; won: number; lost: number }
const zero: Totals = { total: 0, qualified: 0, converted: 0, won: 0, lost: 0 };

/** Cohort = leads CREATED in the range. Conversion rate = converted-to-contact leads of that cohort / cohort size. */
export async function leadSummary(c: AnalyticsContext, range: Range, f: LeadFilters = {}) {
  const [cohort, conv] = await Promise.all([
    exec<Totals>(Lead.aggregate(pipeline([{ $match: scoped(c, 'leads', inRange('createdAt', range), ...conds(f)) }, { $group: { _id: null, ...leadTotalsGroup } }]))),
    exec<{ n: number; avgMs: number }>(
      Lead.aggregate(pipeline([
        { $match: scoped(c, 'leads', inRange('convertedAt', range), ...conds(f)) },
        { $match: { $expr: { $gte: ['$convertedAt', '$createdAt'] } } },
        { $group: { _id: null, n: { $sum: 1 }, avgMs: { $avg: { $subtract: ['$convertedAt', '$createdAt'] } } } },
      ])),
    ),
  ]);
  const t = cohort[0] ?? zero;
  const cv = conv[0];
  return {
    newLeads: t.total, qualified: t.qualified, converted: t.converted, won: t.won, lost: t.lost,
    conversionRate: rate(t.converted, t.total),
    qualifiedRate: rate(t.qualified, t.total),
    convertedInPeriod: cv?.n ?? 0,
    avgDaysToConvert: cv?.n ? round1(cv.avgMs / 86_400_000) : null,
  };
}

/** Snapshot: every active (not archived) lead visible to the caller, regardless of the date range. */
export const leadTotal = (c: AnalyticsContext, f: LeadFilters = {}) => Lead.countDocuments(scoped(c, 'leads', ...conds(f)) as never);

export async function leadTrend(c: AnalyticsContext, f: LeadFilters = {}): Promise<Series[]> {
  const [created, converted] = await Promise.all([
    exec<{ _id: string; count: number }>(Lead.aggregate(pipeline([{ $match: scoped(c, 'leads', inRange('createdAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$createdAt', c), count: { $sum: 1 } } }]))),
    exec<{ _id: string; count: number }>(Lead.aggregate(pipeline([{ $match: scoped(c, 'leads', inRange('convertedAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$convertedAt', c), count: { $sum: 1 } } }]))),
  ]);
  return [countSeries(c, 'leadsCreated', 'New leads', created), countSeries(c, 'leadsConverted', 'Leads converted to contacts', converted)];
}

export async function leadsByAssignee(c: AnalyticsContext, range: Range, f: LeadFilters = {}) {
  return exec<Totals & { _id: unknown }>(
    Lead.aggregate(pipeline([{ $match: scoped(c, 'leads', inRange('createdAt', range), ...conds(f)) }, { $group: { _id: '$assignedTo', ...leadTotalsGroup } }])),
  );
}

export async function leadAnalytics(c: AnalyticsContext, f: LeadFilters = {}) {
  const facets = Lead.aggregate(pipeline([
    { $match: scoped(c, 'leads', inRange('createdAt', c.range), ...conds(f)) },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        bySource: [{ $group: { _id: '$leadSource', count: { $sum: 1 } } }],
        byType: [{ $group: { _id: '$leadType', count: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
      },
    },
  ]));
  const [summary, previous, total, facetRows, byAssignee, series] = await Promise.all([
    leadSummary(c, c.range, f),
    leadSummary(c, c.previous, f),
    leadTotal(c, f),
    exec<Record<string, Array<{ _id: string; count: number }>>>(facets),
    leadsByAssignee(c, c.range, f),
    leadTrend(c, f),
  ]);
  const fx = facetRows[0] ?? {};
  const n = summary.newLeads;
  const names = await resolveAssignees(c, byAssignee.map((r) => r._id));

  return {
    summary: { totalLeads: total, ...summary },
    previous,
    comparison: {
      newLeads: compare(summary.newLeads, previous.newLeads),
      qualified: compare(summary.qualified, previous.qualified),
      converted: compare(summary.converted, previous.converted),
      conversionRate: compare(summary.conversionRate, previous.conversionRate, 'points'),
    },
    byStatus: distribution(fx.byStatus ?? [], n, LEAD_STATUSES),
    bySource: distribution(fx.bySource ?? [], n, LEAD_SOURCES),
    byType: distribution(fx.byType ?? [], n, LEAD_TYPES),
    byPriority: distribution(fx.byPriority ?? [], n, LEAD_PRIORITIES),
    byAgent: byAssignee
      .map((r) => ({ userId: r._id ? String(r._id) : null, name: assigneeLabel(names, r._id), total: r.total, qualified: r.qualified, converted: r.converted, won: r.won, lost: r.lost, conversionRate: rate(r.converted, r.total) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    series,
  };
}