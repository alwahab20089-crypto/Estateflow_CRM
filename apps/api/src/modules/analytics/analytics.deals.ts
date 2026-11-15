import { DEAL_STAGES } from '../../constants';
import { OPEN_DEAL_STAGES } from '../deals/deal.lifecycle';
import { Deal } from '../deals/deal.model';
import { startOfDayUtc, ymdInTz, addDays } from './tz';
import {
  assigneeLabel, bucketExpr, compare, countSeries, exec, inRange, moneySeries, pipeline, rate, resolveAssignees, round1, scoped, toCurrencyAmounts,
  type AnalyticsContext, type Cond, type CurrencyAmount, type Range, type Series,
} from './analytics.context';

const OPEN = [...OPEN_DEAL_STAGES] as string[];
export interface DealFilters { dealType?: string; status?: string }
const conds = (f: DealFilters): Cond[] => [...(f.dealType ? [{ dealType: f.dealType }] : []), ...(f.status ? [{ stage: f.status }] : [])];

/** A deal's closing moment. closeWon/closeLost always set actualClosingDate; stageChangedAt is only a defensive fallback. */
export const closedAtExpr = { $ifNull: ['$actualClosingDate', '$stageChangedAt'] };
export const closedIn = (r: Range): Cond => ({
  $or: [{ actualClosingDate: { $gte: r.from, $lt: r.to } }, { actualClosingDate: null, stageChangedAt: { $gte: r.from, $lt: r.to } }],
});
const sumGroup = { count: { $sum: 1 }, amount: { $sum: '$valueAmount' } };
const ONE_DAY = 86_400_000;

/**
 * Period metrics. A deal is a single document, so a deal that was won, reopened and won again is counted ONCE, in the period of its
 * latest close; a reopened deal that is open again is counted in no closed bucket. Values are NEVER summed across currencies.
 */
export async function dealSummary(c: AnalyticsContext, range: Range, f: DealFilters = {}) {
  const won = scoped(c, 'deals', { stage: 'WON' }, closedIn(range), ...conds(f));
  const [created, wonRows, lost, close] = await Promise.all([
    Deal.countDocuments(scoped(c, 'deals', inRange('createdAt', range), ...conds(f)) as never),
    exec<{ _id: string; count: number; amount: number }>(Deal.aggregate(pipeline([{ $match: won }, { $group: { _id: '$currency', ...sumGroup } }]))),
    Deal.countDocuments(scoped(c, 'deals', { stage: 'LOST' }, closedIn(range), ...conds(f)) as never),
    exec<{ n: number; avgMs: number }>(
      Deal.aggregate(pipeline([
        { $match: won },
        { $addFields: { closedAt: closedAtExpr } },
        { $match: { $expr: { $gte: ['$closedAt', '$createdAt'] } } },
        { $group: { _id: null, n: { $sum: 1 }, avgMs: { $avg: { $subtract: ['$closedAt', '$createdAt'] } } } },
      ])),
    ),
  ]);
  const wonValue = toCurrencyAmounts(wonRows);
  const wonCount = wonValue.reduce((s, x) => s + x.count, 0);
  return {
    created,
    won: { count: wonCount, byCurrency: wonValue },
    lost,
    closed: wonCount + lost,
    /** Win rate = won / (won + lost) among deals CLOSED in the period. Open deals are not in the denominator. */
    winRate: rate(wonCount, wonCount + lost),
    avgDaysToClose: close[0]?.n ? round1(close[0].avgMs / ONE_DAY) : null,
    closeSample: close[0]?.n ?? 0,
  };
}

/** Snapshot of the open pipeline: open stage + not archived. Lost and won deals never contribute. */
export async function dealSnapshot(c: AnalyticsContext, f: DealFilters = {}) {
  const rows = await exec<{ _id: string; count: number; amount: number; weighted: number }>(
    Deal.aggregate(pipeline([
      { $match: scoped(c, 'deals', { stage: { $in: OPEN } }, ...conds(f)) },
      { $group: { _id: '$currency', ...sumGroup, weighted: { $sum: { $multiply: ['$valueAmount', { $divide: ['$probability', 100] }] } } } },
    ])),
  );
  const pipelineValue: Array<CurrencyAmount & { weighted: number }> = rows
    .map((r) => ({ currency: r._id, count: r.count, amount: Math.round(r.amount), weighted: Math.round(r.weighted) }))
    .sort((a, b) => b.amount - a.amount);
  return { open: pipelineValue.reduce((s, x) => s + x.count, 0), pipeline: pipelineValue };
}

async function expectedClosing(c: AnalyticsContext, f: DealFilters) {
  const startToday = startOfDayUtc(ymdInTz(c.now, c.timezone), c.timezone);
  const day = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: c.timezone } });
  const [open, timing] = await Promise.all([
    exec<{ dueInPeriod: Array<{ _id: string; count: number; amount: number }>; overdue: Array<{ n: number }> }>(
      Deal.aggregate(pipeline([
        { $match: scoped(c, 'deals', { stage: { $in: OPEN } }, { expectedClosingDate: { $ne: null } }, ...conds(f)) },
        {
          $facet: {
            dueInPeriod: [{ $match: inRange('expectedClosingDate', c.range) }, { $group: { _id: '$currency', ...sumGroup } }],
            overdue: [{ $match: { expectedClosingDate: { $lt: startToday } } }, { $count: 'n' }],
          },
        },
      ])),
    ),
    exec<{ total: number; onTime: number }>(
      Deal.aggregate(pipeline([
        { $match: scoped(c, 'deals', { stage: 'WON' }, closedIn(c.range), { expectedClosingDate: { $ne: null } }, ...conds(f)) },
        { $addFields: { closedAt: closedAtExpr } },
        { $group: { _id: null, total: { $sum: 1 }, onTime: { $sum: { $cond: [{ $lte: [day('$closedAt'), day('$expectedClosingDate')] }, 1, 0] } } } },
      ])),
    ),
  ]);
  const o = open[0];
  const dueInPeriod = toCurrencyAmounts(o?.dueInPeriod ?? []);
  return {
    openDueInPeriod: { count: dueInPeriod.reduce((s, x) => s + x.count, 0), byCurrency: dueInPeriod },
    openPastExpectedDate: o?.overdue[0]?.n ?? 0,
    wonWithExpectedDate: timing[0]?.total ?? 0,
    wonOnOrBeforeExpectedDate: timing[0]?.onTime ?? 0,
    onTimeRate: rate(timing[0]?.onTime ?? 0, timing[0]?.total ?? 0),
  };
}

export async function dealTrend(c: AnalyticsContext, f: DealFilters = {}): Promise<Series[]> {
  const [created, won] = await Promise.all([
    exec<{ _id: string; count: number }>(Deal.aggregate(pipeline([{ $match: scoped(c, 'deals', inRange('createdAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$createdAt', c), count: { $sum: 1 } } }]))),
    exec<{ _id: { b: string; c: string }; count: number; amount: number }>(
      Deal.aggregate(pipeline([
        { $match: scoped(c, 'deals', { stage: 'WON' }, closedIn(c.range), ...conds(f)) },
        { $addFields: { closedAt: closedAtExpr } },
        { $group: { _id: { b: bucketExpr('$closedAt', c), c: '$currency' }, ...sumGroup } },
      ])),
    ),
  ]);
  const wonCount = new Map<string, number>();
  for (const r of won) wonCount.set(r._id.b, (wonCount.get(r._id.b) ?? 0) + r.count);
  return [
    countSeries(c, 'dealsCreated', 'Deals created', created),
    countSeries(c, 'dealsWon', 'Deals won', [...wonCount].map(([_id, count]) => ({ _id, count }))),
    moneySeries(c, 'dealsWonValue', 'Won deal value', won),
  ];
}

interface RawAssigneeRow { _id: { a: unknown; s: string; c: string }; count: number; amount: number }
/** open = current snapshot; won / lost = closed in the range. Attribution = CURRENT assignee (there is no assignment history). */
export const dealsByAssigneeRaw = (c: AnalyticsContext, range: Range) =>
  exec<RawAssigneeRow>(
    Deal.aggregate(pipeline([
      { $match: scoped(c, 'deals', { $or: [{ stage: { $in: OPEN } }, { $and: [{ stage: { $in: ['WON', 'LOST'] } }, closedIn(range)] }] }) },
      { $group: { _id: { a: '$assignedTo', s: { $cond: [{ $in: ['$stage', OPEN] }, 'OPEN', '$stage'] }, c: '$currency' }, ...sumGroup } },
    ])),
  );

export async function dealsByAssignee(c: AnalyticsContext, range: Range) {
  const raw = await dealsByAssigneeRaw(c, range);
  const out = new Map<string, { assignee: unknown; open: number; won: number; lost: number; wonValue: Map<string, { count: number; amount: number }> }>();
  for (const r of raw) {
    const key = r._id.a ? String(r._id.a) : 'unassigned';
    const row = out.get(key) ?? { assignee: r._id.a ?? null, open: 0, won: 0, lost: 0, wonValue: new Map() };
    if (r._id.s === 'OPEN') row.open += r.count;
    else if (r._id.s === 'LOST') row.lost += r.count;
    else {
      row.won += r.count;
      const w = row.wonValue.get(r._id.c) ?? { count: 0, amount: 0 };
      w.count += r.count;
      w.amount += Math.round(r.amount);
      row.wonValue.set(r._id.c, w);
    }
    out.set(key, row);
  }
  return [...out.values()].map((r) => ({ assignee: r.assignee, open: r.open, won: r.won, lost: r.lost, wonValue: [...r.wonValue].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.amount - a.amount) }));
}

export async function dealAnalytics(c: AnalyticsContext, f: DealFilters = {}) {
  const stageRows = Deal.aggregate(pipeline([
    { $match: scoped(c, 'deals', ...conds(f), { $or: [{ stage: { $in: OPEN } }, { $and: [{ stage: { $in: ['WON', 'LOST'] } }, closedIn(c.range)] }] }) },
    { $group: { _id: { s: '$stage', c: '$currency' }, ...sumGroup } },
  ]));
  const typeRows = Deal.aggregate(pipeline([
    { $match: scoped(c, 'deals', inRange('createdAt', c.range), ...conds(f)) },
    { $group: { _id: { t: '$dealType', c: '$currency' }, ...sumGroup } },
  ]));
  const [summary, previous, snapshot, expected, stages, types, series, byAgent] = await Promise.all([
    dealSummary(c, c.range, f),
    dealSummary(c, c.previous, f),
    dealSnapshot(c, f),
    expectedClosing(c, f),
    exec<{ _id: { s: string; c: string }; count: number; amount: number }>(stageRows),
    exec<{ _id: { t: string; c: string }; count: number; amount: number }>(typeRows),
    dealTrend(c, f),
    dealsByAssignee(c, c.range),
  ]);

  const byStage = DEAL_STAGES.map((stage) => {
    const rows = stages.filter((r) => r._id.s === stage);
    return { stage, count: rows.reduce((s, r) => s + r.count, 0), values: toCurrencyAmounts(rows.map((r) => ({ _id: r._id.c, count: r.count, amount: r.amount }))) };
  });
  const typeKeys = [...new Set(types.map((t) => t._id.t))].sort();
  const names = await resolveAssignees(c, byAgent.map((r) => r.assignee));

  return {
    summary, previous,
    comparison: {
      created: compare(summary.created, previous.created),
      won: compare(summary.won.count, previous.won.count),
      lost: compare(summary.lost, previous.lost),
      winRate: compare(summary.winRate, previous.winRate, 'points'),
    },
    pipeline: snapshot,
    expectedClosing: expected,
    byStage,
    wonVsLost: { won: summary.won.count, lost: summary.lost },
    byType: typeKeys.map((type) => {
      const rows = types.filter((t) => t._id.t === type);
      return { type, count: rows.reduce((s, r) => s + r.count, 0), values: toCurrencyAmounts(rows.map((r) => ({ _id: r._id.c, count: r.count, amount: r.amount }))) };
    }),
    byAgent: byAgent.map((r) => ({ userId: r.assignee ? String(r.assignee) : null, name: assigneeLabel(names, r.assignee), open: r.open, won: r.won, lost: r.lost, wonValue: r.wonValue, winRate: rate(r.won, r.won + r.lost) })),
    series,
    definitions: {
      pipelineValue: 'Sum of valueAmount of OPEN, non-archived deals, per currency. Not revenue.',
      wonDealValue: 'Sum of valueAmount of deals WON in the period, per currency. This is the agreed deal value, NOT cash collected.',
      winRate: 'won / (won + lost) among deals closed in the period.',
    },
  };
}
export { addDays };