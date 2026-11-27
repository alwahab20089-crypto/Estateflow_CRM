import { AlarmClock, Columns3, Home, Trophy, UserPlus, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { kpiProps } from '@/features/analytics/analytics-format';
import { TrendChart } from '@/features/analytics/charts';
import { MetricCard } from '@/features/analytics/metric-card';
import { useAnalyticsOverview, useAnalyticsTrends } from '@/features/analytics/use-analytics';
import { useFeature } from '@/features/license/use-license';
import { useAuth } from '@/providers/auth-provider';

const ORDER = ['newLeads', 'activeDeals', 'wonDealValue', 'availableProperties', 'overdueTasks'];

const ICONS: Record<string, LucideIcon> = {
  newLeads: UserPlus,
  activeDeals: Columns3,
  wonDealValue: Trophy,
  availableProperties: Home,
  overdueTasks: AlarmClock,
};

const RANGE = { period: '30d' } as const;

export function AnalyticsSummary() {
  const { can } = useAuth();
  const analyticsFeature = useFeature('analytics');
  const allowed = can('analytics:read') && analyticsFeature.allowed;

  const overview = useAnalyticsOverview(RANGE, allowed);

  const trendMetrics = ['leadsCreated', 'dealsWon']
    .filter((m) => can(m === 'leadsCreated' ? 'leads:read' : 'deals:read'))
    .join(',');

  const trends = useAnalyticsTrends(
    { ...RANGE, metrics: trendMetrics },
    allowed && trendMetrics !== '',
  );

  if (!allowed) return null;

  if (overview.isError) {
    return (
      <Card>
        <ErrorState onRetry={() => void overview.refetch()} />
      </Card>
    );
  }

  if (!overview.data) {
    return (
      <div
        role="status"
        aria-label="Loading performance summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const { data, meta } = overview.data;

  const kpis = ORDER.map((k) => data.kpis.find((x) => x.key === k)).filter(
    (k): k is NonNullable<typeof k> => Boolean(k),
  );

  if (kpis.length === 0) return null;

  return (
    <section aria-label="Performance summary" className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-section-title">Performance, last 30 days</h2>
          <p className="text-caption">Won deal value is agreed value, not collected revenue.</p>
        </div>
        <Link to="/app/analytics" className="text-sm font-medium text-primary hover:underline">
          View analytics
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((k) => (
          <MetricCard
            key={k.key}
            icon={ICONS[k.key]}
            compact
            {...kpiProps(k, meta.currency, true)}
            positiveIsGood={k.key !== 'overdueTasks'}
          />
        ))}
      </div>

      {trends.data && trends.data.data.series.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-section-title">Recent trend</CardTitle>
            <CardDescription>
              New leads and won deals per {trends.data.data.groupBy}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart
              title="Recent trend"
              series={trends.data.data.series}
              groupBy={trends.data.data.groupBy}
              height={200}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
