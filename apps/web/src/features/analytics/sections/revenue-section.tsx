import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { Card } from '@/components/ui/card';
import { formatMinor } from '@/lib/money';
import { describeChange, labelOf } from '../analytics-format';
import { ChartCard, Fade, NUM, Notes, SectionSkeleton, SimpleTable } from '../analytics-ui';
import { MoneyTrendChart } from '../charts';
import { useRevenueAnalytics } from '../use-analytics';
import type { SectionProps } from './section-props';

const TYPES = [{ value: 'SALE', label: 'Sale' }, { value: 'RENT', label: 'Rent' }, { value: 'LEASE', label: 'Lease' }];

export function RevenueSection({ range, compare }: SectionProps) {
  const [dealType, setDealType] = useState<string>();
  const q = useRevenueAnalytics({ ...range, ...(dealType ? { dealType } : {}) });
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const won = d.wonDealValue;

  return (
    <Fade fetching={q.isPlaceholderData}>
      <Notes title="Won deal value is not collected revenue" items={d.notes} />
      <FilterSelect label="Deal type" allLabel="All deal types" value={dealType} options={TYPES} onChange={setDealType} className="w-full sm:w-44" />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Won deal value" description="Agreed value of deals won in the period, per currency.">
          {won.byCurrency.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals were won in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <SimpleTable
                caption="Won deal value by currency"
                rows={won.byCurrency}
                getKey={(r) => r.currency}
                columns={[
                  { header: 'Currency', cell: (r) => r.currency },
                  { header: 'Won deals', cell: (r) => r.count, className: NUM },
                  { header: 'Won deal value', cell: (r) => formatMinor(r.amount, r.currency), className: NUM },
                  ...(compare ? [
                    { header: 'Previous period', cell: (r: (typeof won.byCurrency)[number]) => formatMinor(r.previousAmount, r.currency), className: NUM },
                    { header: 'Change', cell: (r: (typeof won.byCurrency)[number]) => describeChange(r.comparison, 'money')?.text ?? '—' },
                  ] : []),
                ]}
              />
            </div>
          )}
        </ChartCard>
        <ChartCard title="Won deal value by deal type">
          {won.byDealType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals were won in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <SimpleTable
                caption="Won deal value by deal type"
                rows={won.byDealType.flatMap((t) => t.values.map((v) => ({ type: t.type, ...v })))}
                getKey={(r) => `${r.type}-${r.currency}`}
                columns={[
                  { header: 'Deal type', cell: (r) => labelOf(r.type) },
                  { header: 'Currency', cell: (r) => r.currency },
                  { header: 'Won deals', cell: (r) => r.count, className: NUM },
                  { header: 'Won deal value', cell: (r) => formatMinor(r.amount, r.currency), className: NUM },
                ]}
              />
            </div>
          )}
        </ChartCard>
        <ChartCard title="Won deal value trend" className="lg:col-span-2">
          <MoneyTrendChart title="Won deal value" series={d.series[0]} currency={meta.currency} groupBy={meta.groupBy} />
        </ChartCard>
        <ChartCard title="Open pipeline" description="Expected value of open deals now. The weighted figure multiplies each deal by its probability and is an estimate only." className="lg:col-span-2">
          {d.pipeline.pipeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no open deals.</p>
          ) : (
            <div className="overflow-x-auto">
              <SimpleTable
                caption="Open pipeline by currency"
                rows={d.pipeline.pipeline}
                getKey={(r) => r.currency}
                columns={[
                  { header: 'Currency', cell: (r) => r.currency },
                  { header: 'Open deals', cell: (r) => r.count, className: NUM },
                  { header: 'Pipeline value', cell: (r) => formatMinor(r.amount, r.currency), className: NUM },
                  { header: 'Probability-weighted (estimate)', cell: (r) => formatMinor(r.weighted, r.currency), className: NUM },
                ]}
              />
            </div>
          )}
        </ChartCard>
        <ChartCard title="Collected revenue" className="lg:col-span-2">
          <p className="text-sm text-muted-foreground">Not available. EstateFlow has no payment or transaction records yet, so no figure on this page is cash received.</p>
        </ChartCard>
      </div>
    </Fade>
  );
}