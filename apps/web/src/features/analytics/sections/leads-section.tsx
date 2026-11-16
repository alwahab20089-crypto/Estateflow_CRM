import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { leadSourceLabels } from '@/lib/labels';
import { cmp, formatDays, formatPercent } from '../analytics-format';
import { ChartCard, Fade, NUM, SectionSkeleton, SimpleTable } from '../analytics-ui';
import { DistributionChart, GroupedBarChart, TrendChart } from '../charts';
import { MetricCard } from '../metric-card';
import { useLeadAnalytics } from '../use-analytics';
import type { SectionProps } from './section-props';

const SOURCES = Object.entries(leadSourceLabels).map(([value, label]) => ({ value, label }));

export function LeadsSection({ range, compare }: SectionProps) {
  const [leadSource, setLeadSource] = useState<string>();
  const q = useLeadAnalytics({ ...range, ...(leadSource ? { leadSource } : {}) });
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const s = d.summary;
  const cur = meta.currency;
  const agents = [...d.byAgent].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Fade fetching={q.isPlaceholderData}>
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Lead source" allLabel="All sources" value={leadSource} options={SOURCES} onChange={setLeadSource} className="w-full sm:w-48" />
        <p className="text-caption">Conversion rate = leads created in the period that were converted to a contact ÷ all leads created in the period.</p>
      </div>
      <section aria-label="Lead metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total leads" value={formatNumber(s.totalLeads)} snapshot description="All active leads you can see, regardless of the date range." />
        <MetricCard label="New leads" value={formatNumber(s.newLeads)} {...cmp(d.comparison.newLeads, 'count', cur, compare)} description="Leads created in the period." />
        <MetricCard label="Qualified leads" value={formatNumber(s.qualified)} {...cmp(d.comparison.qualified, 'count', cur, compare)} description="Created in the period and now QUALIFIED or later (not lost)." />
        <MetricCard label="Converted leads" value={formatNumber(s.converted)} {...cmp(d.comparison.converted, 'count', cur, compare)} description="Created in the period and converted to a contact." />
        <MetricCard label="Conversion rate" value={formatPercent(s.conversionRate)} emptyHint={s.conversionRate === null ? 'No leads created in this period' : undefined} {...cmp(d.comparison.conversionRate, 'rate', cur, compare)} />
        <MetricCard label="Average time to convert" value={formatDays(s.avgDaysToConvert)} description={`Based on ${s.convertedInPeriod} lead(s) converted in the period.`} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Lead acquisition trend" className="lg:col-span-2"><TrendChart title="Lead acquisition trend" series={d.series} groupBy={meta.groupBy} /></ChartCard>
        <ChartCard title="Leads by status"><DistributionChart title="Leads by status" items={d.byStatus} variant="donut" noun="Leads" /></ChartCard>
        <ChartCard title="Leads by source"><DistributionChart title="Leads by source" items={d.bySource} noun="Leads" /></ChartCard>
        <ChartCard title="Leads by type"><DistributionChart title="Leads by type" items={d.byType} noun="Leads" /></ChartCard>
        <ChartCard title="Leads by priority"><DistributionChart title="Leads by priority" items={d.byPriority} noun="Leads" /></ChartCard>
        <ChartCard title="Agent lead performance" description="Leads created in the period, by current assignee." className="lg:col-span-2">
          <GroupedBarChart title="Agent lead performance" rows={agents.map((a) => ({ name: a.name, total: a.total, qualified: a.qualified, converted: a.converted }))} bars={[{ key: 'total', label: 'Leads' }, { key: 'qualified', label: 'Qualified' }, { key: 'converted', label: 'Converted' }]} />
          <div className="mt-4 overflow-x-auto">
            <SimpleTable
              caption="Lead performance by agent"
              rows={agents}
              getKey={(r, i) => `${r.userId ?? 'none'}-${i}`}
              columns={[
                { header: 'Agent', cell: (r) => r.name },
                { header: 'Leads', cell: (r) => r.total, className: NUM },
                { header: 'Qualified', cell: (r) => r.qualified, className: NUM },
                { header: 'Converted', cell: (r) => r.converted, className: NUM },
                { header: 'Won', cell: (r) => r.won, className: NUM },
                { header: 'Lost', cell: (r) => r.lost, className: NUM },
                { header: 'Conversion', cell: (r) => formatPercent(r.conversionRate), className: NUM },
              ]}
            />
          </div>
        </ChartCard>
      </div>
    </Fade>
  );
}