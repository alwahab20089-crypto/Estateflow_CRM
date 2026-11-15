import { bucketKeys, can, type AnalyticsContext } from './analytics.context';
import { dealTrend } from './analytics.deals';
import { leadTrend } from './analytics.leads';
import { propertyTrend } from './analytics.properties';
import { taskTrend } from './analytics.tasks';
import { TREND_METRICS, type TrendMetric } from './analytics.validation';

const SECTION: Record<TrendMetric, 'leads' | 'deals' | 'properties' | 'tasks'> = {
  leadsCreated: 'leads', leadsConverted: 'leads', dealsCreated: 'deals', dealsWon: 'deals', dealsWonValue: 'deals',
  propertiesAdded: 'properties', tasksCreated: 'tasks', tasksCompleted: 'tasks',
};

export async function trendAnalytics(c: AnalyticsContext, wanted?: string[]) {
  const metrics = (wanted?.length ? wanted : [...TREND_METRICS]) as TrendMetric[];
  const allowed = metrics.filter((m) => can(c, `${SECTION[m]}:read`));
  const sections = new Set(allowed.map((m) => SECTION[m]));
  const [l, d, p, t] = await Promise.all([
    sections.has('leads') ? leadTrend(c) : [],
    sections.has('deals') ? dealTrend(c) : [],
    sections.has('properties') ? propertyTrend(c) : [],
    sections.has('tasks') ? taskTrend(c) : [],
  ]);
  const all = [...l, ...d, ...p, ...t];
  return {
    groupBy: c.groupBy,
    buckets: bucketKeys(c),
    series: allowed.map((k) => all.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => Boolean(s)),
    unavailable: metrics.filter((m) => !allowed.includes(m)),
  };
}