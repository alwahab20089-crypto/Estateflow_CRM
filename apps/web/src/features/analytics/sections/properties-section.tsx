import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { formatMinor } from '@/lib/money';
import { humanize } from '@/lib/labels';
import { cmp, labelOf } from '../analytics-format';
import { ChartCard, Fade, NUM, SectionSkeleton, SimpleTable } from '../analytics-ui';
import { DistributionChart, TrendChart } from '../charts';
import { MetricCard } from '../metric-card';
import { usePropertyAnalytics } from '../use-analytics';
import type { SectionProps } from './section-props';

const TYPES = ['HOUSE', 'APARTMENT', 'PLOT', 'COMMERCIAL', 'OFFICE', 'FARMHOUSE', 'OTHER'].map((v) => ({ value: v, label: humanize(v) }));

export function PropertiesSection({ range, compare }: SectionProps) {
  const [propertyType, setPropertyType] = useState<string>();
  const q = usePropertyAnalytics({ ...range, ...(propertyType ? { propertyType } : {}) });
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const total = d.totals.total;
  const count = (k: string) => d.byStatus.find((x) => x.key === k)?.count ?? 0;
  const cities = [...d.byCity.top, ...(d.byCity.otherCount > 0 ? [{ key: 'Other cities', count: d.byCity.otherCount, share: total ? Math.round((d.byCity.otherCount / total) * 1000) / 10 : 0 }] : [])];
  const agents = d.byAgent.map((a) => ({ key: a.name, count: a.count, share: total ? Math.round((a.count / total) * 1000) / 10 : 0 }));

  return (
    <Fade fetching={q.isPlaceholderData}>
      <FilterSelect label="Property type" allLabel="All property types" value={propertyType} options={TYPES} onChange={setPropertyType} className="w-full sm:w-48" />
      <section aria-label="Property metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total properties" snapshot value={formatNumber(total)} description="Non-archived properties." />
        <MetricCard label="Active properties" snapshot value={formatNumber(d.totals.active)} description="On the market: available, under offer or reserved." />
        <MetricCard label="Available" snapshot value={formatNumber(d.totals.available)} />
        <MetricCard label="Added in period" value={formatNumber(d.added.count)} {...cmp(d.added.comparison, 'count', meta.currency, compare)} />
        <MetricCard label="Reserved" snapshot value={formatNumber(count('RESERVED'))} />
        <MetricCard label="Under offer" snapshot value={formatNumber(count('UNDER_OFFER'))} />
        <MetricCard label="Sold" snapshot value={formatNumber(count('SOLD'))} />
        <MetricCard label="Rented / leased" snapshot value={formatNumber(count('RENTED') + count('LEASED'))} extra={`Rented ${count('RENTED')} · Leased ${count('LEASED')}`} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Inventory by status"><DistributionChart title="Inventory by status" items={d.byStatus} hideZero={false} noun="Properties" /></ChartCard>
        <ChartCard title="Property type distribution"><DistributionChart title="Property type distribution" items={d.byType} variant="donut" noun="Properties" /></ChartCard>
        <ChartCard title="Listing type distribution"><DistributionChart title="Listing type distribution" items={d.byListingType} variant="donut" noun="Properties" /></ChartCard>
        <ChartCard title="Properties added over time"><TrendChart title="Properties added" series={d.series} groupBy={meta.groupBy} /></ChartCard>
        <ChartCard title="Inventory by city" description={`Top cities of ${d.byCity.distinctCities}.`}><DistributionChart title="Inventory by city" items={cities} rawLabels noun="Properties" /></ChartCard>
        <ChartCard title="Distribution by agent" description="Current assignee."><DistributionChart title="Distribution by agent" items={agents} rawLabels noun="Properties" /></ChartCard>
      </div>
      <ChartCard title="Average asking price" description="Asking prices of active properties, averaged only within one currency, listing type and rent period. Not sales revenue.">
        {d.averageListingPrice.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active properties with a price.</p>
        ) : (
          <div className="overflow-x-auto">
            <SimpleTable
              caption="Average asking price"
              rows={d.averageListingPrice}
              getKey={(r, i) => `${r.currency}-${r.listingType}-${r.rentPeriod}-${i}`}
              columns={[
                { header: 'Currency', cell: (r) => r.currency },
                { header: 'Listing', cell: (r) => labelOf(r.listingType) },
                { header: 'Rent period', cell: (r) => (r.rentPeriod ? labelOf(r.rentPeriod) : '—') },
                { header: 'Properties', cell: (r) => r.count, className: NUM },
                { header: 'Average asking price', cell: (r) => formatMinor(r.average, r.currency), className: NUM },
              ]}
            />
          </div>
        )}
      </ChartCard>
    </Fade>
  );
}