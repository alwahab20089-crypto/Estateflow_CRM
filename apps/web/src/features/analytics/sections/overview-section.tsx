import { AlarmClock, Building2, Columns3, Home, ListChecks, Percent, Target, Trophy, UserCheck, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/providers/auth-provider';
import type { RangeParams, TrendMetric } from '@/types/analytics';
import { kpiProps } from '../analytics-format';
import { ChartCard, Fade, Notes, SectionSkeleton } from '../analytics-ui';
import { TrendChart } from '../charts';
import { MetricCard } from '../metric-card';
import { useAnalyticsTrends, type OverviewQuery } from '../use-analytics';

export const KPI_ICONS: Record<string, LucideIcon> = {
  totalLeads: Target, newLeads: UserPlus, qualifiedLeads: UserCheck, leadConversionRate: Percent,
  activeProperties: Building2, availableProperties: Home, activeDeals: Columns3, wonDeals: Trophy,
  pipelineValue: Wallet, wonDealValue: Trophy, overdueTasks: AlarmClock, taskCompletionRate: ListChecks,
};

const TREND_OPTIONS: Array<{ key: TrendMetric; label: string; needs: string }> = [
  { key: 'leadsCreated', label: 'New leads', needs: 'leads:read' },
  { key: 'leadsConverted', label: 'Leads converted', needs: 'leads:read' },
  { key: 'dealsCreated', label: 'Deals created', needs: 'deals:read' },
  { key: 'dealsWon', label: 'Deals won', needs: 'deals:read' },
  { key: 'propertiesAdded', label: 'Properties added', needs: 'properties:read' },
  { key: 'tasksCreated', label: 'Tasks created', needs: 'tasks:read' },
  { key: 'tasksCompleted', label: 'Tasks completed', needs: 'tasks:read' },
];
const DEFAULT_TRENDS: TrendMetric[] = ['leadsCreated', 'dealsWon', 'tasksCompleted'];

function TrendsCard({ range }: { range: RangeParams }) {
  const { can } = useAuth();
  const allowed = TREND_OPTIONS.filter((o) => can(o.needs));
  const [selected, setSelected] = useState<TrendMetric[]>(() => DEFAULT_TRENDS.filter((m) => allowed.some((o) => o.key === m)));
  const metrics = [...selected].sort().join(',');
  const q = useAnalyticsTrends({ ...range, metrics }, selected.length > 0);

  if (allowed.length === 0) return null;
  const toggle = (k: TrendMetric) =>
    setSelected((prev) => (prev.includes(k) ? (prev.length === 1 ? prev : prev.filter((x) => x !== k)) : [...prev, k]));

  return (
    <ChartCard title="Activity over time" description="Counts per period. Pick the series to compare.">
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Trend series">
        {allowed.map((o) => (
          <Button key={o.key} type="button" size="sm" variant={selected.includes(o.key) ? 'default' : 'outline'} aria-pressed={selected.includes(o.key)} onClick={() => toggle(o.key)}>
            {o.label}
          </Button>
        ))}
      </div>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data ? <SectionSkeleton count={0} /> : <TrendChart title="Activity over time" series={q.data.data.series} groupBy={q.data.data.groupBy} />}
    </ChartCard>
  );
}

export function OverviewSection({ query, range, compare }: { query: OverviewQuery; range: RangeParams; compare: boolean }) {
  if (query.isError) return <Card><ErrorState onRetry={() => void query.refetch()} /></Card>;
  if (!query.data) return <SectionSkeleton count={12} />;
  const { data, meta } = query.data;

  return (
    <Fade fetching={query.isPlaceholderData}>
      {data.kpis.length === 0 ? (
        <Card>
          <EmptyState title="No metrics available" description="Your role does not include access to any analytics modules." />
        </Card>
      ) : (
        <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((k) => (
            <MetricCard key={k.key} icon={KPI_ICONS[k.key]} {...kpiProps(k, meta.currency, compare)} />
          ))}
        </section>
      )}
      <TrendsCard range={range} />
      <Notes title="About these numbers" items={[...data.limitations, ...data.unavailable.map((u) => `${u[0]!.toUpperCase()}${u.slice(1)} metrics are hidden because your role cannot read that module.`)]} />
    </Fade>
  );
}