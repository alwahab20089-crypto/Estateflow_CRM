import type { AnalyticsMeta, Comparison, DistributionItem, Kpi, LeadAnalytics, OverviewData } from '@/types/analytics';

export const makeMeta = (over: Partial<AnalyticsMeta> = {}): AnalyticsMeta => ({
  range: { from: '2026-10-17', to: '2026-11-15', days: 30 },
  previousRange: { from: '2026-09-17', to: '2026-10-16', days: 30 },
  timezone: 'Asia/Karachi',
  groupBy: 'day',
  currency: 'USD',
  scope: 'organization',
  generatedAt: '2026-11-15T14:00:00.000Z',
  ...over,
});

export const cmp = (over: Partial<Comparison> = {}): Comparison => ({ previous: 8, changePct: 25, changePoints: null, direction: 'up', ...over });

export const makeKpis = (): Kpi[] => [
  { key: 'totalLeads', label: 'Total Leads', section: 'leads', kind: 'count', period: 'snapshot', value: 120, comparison: null, description: 'All active leads.' },
  { key: 'newLeads', label: 'New Leads', section: 'leads', kind: 'count', period: 'range', value: 10, comparison: cmp(), description: 'Leads created in the period.' },
  { key: 'leadConversionRate', label: 'Lead Conversion Rate', section: 'leads', kind: 'rate', period: 'range', value: 20, comparison: cmp({ previous: 17.5, changePct: null, changePoints: 2.5 }), description: 'Converted ÷ created.' },
  { key: 'wonDeals', label: 'Won Deals', section: 'deals', kind: 'count', period: 'range', value: 3, comparison: cmp({ previous: 0, changePct: null, direction: 'new' }), description: 'Won in the period.' },
  {
    key: 'wonDealValue', label: 'Won Deal Value', section: 'deals', kind: 'money', period: 'range', value: 1_250_000,
    amounts: [{ currency: 'USD', amount: 1_250_000 }, { currency: 'EUR', amount: 50_000 }], comparison: cmp({ previous: 1_000_000 }), description: 'Agreed value. Not cash collected.',
  },
];

export const overviewResult = (kpis: Kpi[] = makeKpis()) => ({
  data: { kpis, unavailable: [], limitations: ['Won Deal Value is the agreed value of won deals, not collected revenue.'] } as OverviewData,
  meta: makeMeta(),
});

export const trendsResult = () => ({ data: { groupBy: 'day' as const, buckets: [], series: [], unavailable: [] }, meta: makeMeta() });

const dist = (rows: Array<[string, number, number]>): DistributionItem[] => rows.map(([key, count, share]) => ({ key, count, share }));
const summary = { newLeads: 0, qualified: 0, converted: 0, won: 0, lost: 0, conversionRate: null, qualifiedRate: null, convertedInPeriod: 0, avgDaysToConvert: null };

export const leadsResult = (empty = false) => ({
  data: {
    summary: { totalLeads: empty ? 0 : 10, ...summary, newLeads: empty ? 0 : 10 },
    previous: summary,
    comparison: { newLeads: cmp(), qualified: cmp(), converted: cmp(), conversionRate: cmp({ changePct: null, changePoints: 1 }) },
    byStatus: empty ? dist([['NEW', 0, 0]]) : dist([['NEW', 5, 50], ['CONTACTED', 3, 30], ['QUALIFIED', 2, 20]]),
    bySource: empty ? [] : dist([['WEBSITE', 6, 60], ['REFERRAL', 4, 40]]),
    byType: [], byPriority: [], byAgent: [], series: [],
  } as LeadAnalytics,
  meta: makeMeta(),
});