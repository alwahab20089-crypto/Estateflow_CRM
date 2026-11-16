import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { cmp, formatPercent } from '../analytics-format';
import { ChartCard, Fade, NUM, Notes, SectionSkeleton, SimpleTable } from '../analytics-ui';
import { DistributionChart, GroupedBarChart, TrendChart } from '../charts';
import { MetricCard } from '../metric-card';
import { useTaskAnalytics } from '../use-analytics';
import type { SectionProps } from './section-props';

const STATUSES = [{ value: 'TODO', label: 'To do' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }];
const STATUS_COLORS = { COMPLETED: 'var(--success)', CANCELLED: 'var(--chart-5)', TODO: 'var(--chart-1)', IN_PROGRESS: 'var(--chart-3)' };

export function TasksSection({ range, compare }: SectionProps) {
  const [status, setStatus] = useState<string>();
  const q = useTaskAnalytics({ ...range, ...(status ? { status } : {}) });
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const s = d.summary;
  const cur = meta.currency;
  const cancelled = d.byStatus.find((x) => x.key === 'CANCELLED')?.count ?? 0;
  const agents = [...d.byAgent].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Fade fetching={q.isPlaceholderData}>
      <FilterSelect label="Task status" allLabel="All statuses" value={status} options={STATUSES} onChange={setStatus} className="w-full sm:w-44" />
      <section aria-label="Task metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Tasks in period" value={formatNumber(s.cohort)} description="Tasks due in the period, plus undated tasks created in it." />
        <MetricCard label="Completed in period" value={formatNumber(s.completedInPeriod)} {...cmp(d.comparison.completedInPeriod, 'count', cur, compare)} />
        <MetricCard label="Completion rate" value={formatPercent(s.completionRate)} emptyHint={s.completionRate === null ? 'No past-due tasks in this period' : undefined} {...cmp(d.comparison.completionRate, 'rate', cur, compare)} description="Completed ÷ (completed + still open) among tasks whose due date passed in the period. Cancelled and future-due tasks are excluded." />
        <MetricCard label="On-time rate" value={formatPercent(s.onTimeRate)} description="Completed on or before the due date, same population as the completion rate." />
        <MetricCard label="Overdue now" snapshot value={formatNumber(s.overdue)} description="Open tasks whose due date has passed." />
        <MetricCard label="Due today" snapshot value={formatNumber(s.dueToday)} description="Open tasks due today in the report timezone." />
        <MetricCard label="Pending now" snapshot value={formatNumber(s.todo)} extra={`In progress: ${formatNumber(s.inProgress)}`} />
        <MetricCard label="Cancelled in period" value={formatNumber(cancelled)} description="Never counted as completed." />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Task status distribution"><DistributionChart title="Task status distribution" items={d.byStatus} variant="donut" colors={STATUS_COLORS} noun="Tasks" /></ChartCard>
        <ChartCard title="Task completion trend"><TrendChart title="Tasks created and completed" series={d.series} groupBy={meta.groupBy} /></ChartCard>
        <ChartCard title="Tasks by priority"><DistributionChart title="Tasks by priority" items={d.byPriority} noun="Tasks" /></ChartCard>
        <ChartCard title="Tasks by type"><DistributionChart title="Tasks by type" items={d.byType} noun="Tasks" /></ChartCard>
        <ChartCard title="Agent productivity" description="Completed in the period; pending and overdue are right now." className="lg:col-span-2">
          <GroupedBarChart title="Agent productivity" rows={agents.map((a) => ({ name: a.name, completed: a.completed, pending: a.pending, overdue: a.overdue }))} bars={[{ key: 'completed', label: 'Completed' }, { key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }]} />
          <div className="mt-4 overflow-x-auto">
            <SimpleTable
              caption="Task productivity by assignee"
              rows={agents}
              getKey={(r, i) => `${r.userId ?? 'none'}-${i}`}
              columns={[
                { header: 'Assignee', cell: (r) => r.name },
                { header: 'Tasks', cell: (r) => r.cohort, className: NUM },
                { header: 'Completed', cell: (r) => r.completed, className: NUM },
                { header: 'Pending', cell: (r) => r.pending, className: NUM },
                { header: 'Overdue', cell: (r) => r.overdue, className: NUM },
                { header: 'Completion', cell: (r) => formatPercent(r.completionRate), className: NUM },
                { header: 'On time', cell: (r) => formatPercent(r.onTimeRate), className: NUM },
                { header: 'Sample', cell: (r) => r.sample, className: NUM },
              ]}
            />
          </div>
        </ChartCard>
      </div>
      <Notes title="Definitions" items={Object.values(d.definitions)} />
    </Fade>
  );
}