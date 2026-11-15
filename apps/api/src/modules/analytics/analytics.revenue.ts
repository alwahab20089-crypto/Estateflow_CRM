import { Deal } from '../deals/deal.model';
import { compare, exec, pipeline, scoped, toCurrencyAmounts, type AnalyticsContext, type Range } from './analytics.context';
import { closedAtExpr, closedIn, dealSnapshot, dealTrend } from './analytics.deals';

const wonByTypeAndCurrency = (c: AnalyticsContext, range: Range, dealType?: string) =>
  exec<{ _id: { t: string; c: string }; count: number; amount: number }>(
    Deal.aggregate(pipeline([
      { $match: scoped(c, 'deals', { stage: 'WON' }, closedIn(range), ...(dealType ? [{ dealType }] : [])) },
      { $group: { _id: { t: '$dealType', c: '$currency' }, count: { $sum: 1 }, amount: { $sum: '$valueAmount' } } },
    ])),
  );

/**
 * EstateFlow has NO payment or transaction records, so actual collected revenue cannot be computed.
 * This endpoint reports WON DEAL VALUE (agreed value of won deals) and the open pipeline, per currency, and says so explicitly.
 */
export async function revenueAnalytics(c: AnalyticsContext, f: { dealType?: string } = {}) {
  const [cur, prev, snapshot, trend] = await Promise.all([
    wonByTypeAndCurrency(c, c.range, f.dealType),
    wonByTypeAndCurrency(c, c.previous, f.dealType),
    dealSnapshot(c, f),
    dealTrend(c, f),
  ]);
  const group = (rows: typeof cur) => toCurrencyAmounts(
    [...rows.reduce((m, r) => m.set(r._id.c, { count: (m.get(r._id.c)?.count ?? 0) + r.count, amount: (m.get(r._id.c)?.amount ?? 0) + r.amount }), new Map<string, { count: number; amount: number }>())].map(([_id, v]) => ({ _id, ...v })),
  );
  const current = group(cur);
  const previous = group(prev);
  const currencies = [...new Set([...current, ...previous].map((x) => x.currency))].sort();

  return {
    wonDealValue: {
      byCurrency: currencies.map((currency) => {
        const a = current.find((x) => x.currency === currency);
        const b = previous.find((x) => x.currency === currency);
        return { currency, count: a?.count ?? 0, amount: a?.amount ?? 0, previousAmount: b?.amount ?? 0, comparison: compare(a?.amount ?? 0, b?.amount ?? 0) };
      }),
      byDealType: [...new Set(cur.map((r) => r._id.t))].sort().map((type) => ({
        type,
        values: toCurrencyAmounts(cur.filter((r) => r._id.t === type).map((r) => ({ _id: r._id.c, count: r.count, amount: r.amount }))),
      })),
    },
    pipeline: snapshot,
    series: trend.filter((s) => s.key === 'dealsWonValue'),
    collectedRevenue: null,
    isCollectedRevenue: false,
    notes: [
      'Won deal value is the agreed value of deals marked WON in the period. It is not cash received, invoiced or accounting revenue.',
      'No payment or transaction records exist, so collected revenue is not available.',
      'Amounts are integer minor units per currency and are never summed across currencies.',
    ],
  };
}
export { closedAtExpr };