import { useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { formatMinor, fromMinorUnits } from '@/lib/money';
import { amountFor, cmp, formatDays, formatMoneyList, formatPercent, toDistribution } from '../analytics-format';
import { ChartCard, Fade, NUM, SectionSkeleton, SimpleTable } from '../analytics-ui';
import { DistributionChart, GroupedBarChart, MoneyTrendChart, TrendChart, wholeCurrency } from '../charts';
import { MetricCard } from '../metric-card';
import { useDealAnalytics } from '../use-analytics';
import { labelOf } from '../analytics-format';
import type { SectionProps } from './section-props';

const TYPES = [{ value: 'SALE', label: 'Sale' }, { value: 'RENT', label: 'Rent' }, { value: 'LEASE', label: 'Lease' }];
const OUTCOME_COLORS = { WON: 'var(--success)', LOST: 'var(--destructive)' };

export function DealsSection({ range, compare }: SectionProps) {
  const [dealType, setDealType] = useState<string>();
  const q = useDealAnalytics({ ...range, ...(dealType ? { dealType } : {}) });
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const cur = meta.currency;
  const s = d.summary;
  const otherPipeline = d.pipeline.pipeline.filter((p) => p.currency !== cur);
  const otherWon = s.won.byCurrency.filter((p) => p.currency !== cur);
  const agents = [...d.byAgent].sort((a, b) => a.name.localeCompare(b.name));
  const stageItems = toDistribution(d.byStage.map((x) => ({ key: x.stage, count: x.count })));
  const typeItems = toDistribution(d.byType.map((x) => ({ key: x.type, count: x.count })));
  const outcome = toDistribution([{ key: 'WON', count: d.wonVsLost.won }, { key: 'LOST', count: d.wonVsLost.lost }]);
  const otherStageCurrencies = [...new Set(d.byStage.flatMap((x) => x.values.map((v) => v.currency)).filter((c) => c !== cur))];
  const e = d.expectedClosing;

  return (
    <Fade fetching={q.isPlaceholderData}>
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Deal type" allLabel="All deal types" value={dealType} options={TYPES} onChange={setDealType} className="w-full sm:w-44" />
      </div>
      <section aria-label="Deal metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Deals created" value={formatNumber(s.created)} {...cmp(d.comparison.created, 'count', cur, compare)} />
        <MetricCard label="Open deals" value={formatNumber(d.pipeline.open)} snapshot description="Deals in an open stage right now." />
        <MetricCard label="Won deals" value={formatNumber(s.won.count)} {...cmp(d.comparison.won, 'count', cur, compare)} description="Closed as won in the period. A reopened and re-won deal counts once." />
        <MetricCard label="Lost deals" value={formatNumber(s.lost)} {...cmp(d.comparison.lost, 'count', cur, compare)} positiveIsGood={false} />
        <MetricCard label="Win rate" value={formatPercent(s.winRate)} emptyHint={s.winRate === null ? 'No deals closed in this period' : undefined} {...cmp(d.comparison.winRate, 'rate', cur, compare)} description="Won ÷ (won + lost) among deals closed in the period. Open deals are not counted." />
        <MetricCard label="Average time to close" value={formatDays(s.avgDaysToClose)} description={`Based on ${s.closeSample} won deal(s).`} />
        <MetricCard label="Pipeline value" snapshot value={formatMinor(amountFor(d.pipeline.pipeline, cur), cur)} extra={otherPipeline.length ? `Also: ${formatMoneyList(otherPipeline)}` : undefined} description="Open deals only, per currency. Expected value, not revenue." />
        <MetricCard label="Won deal value" value={formatMinor(amountFor(s.won.byCurrency, cur), cur)} extra={otherWon.length ? `Also: ${formatMoneyList(otherWon)}` : undefined} description="Agreed value of won deals. Not cash collected." />
      </section>

      <ChartCard title="Expected closing performance" description="Based on the expected closing date set on each deal.">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Open deals expected to close in this period</dt><dd className="font-medium tabular-nums">{e.openDueInPeriod.count} · {formatMoneyList(e.openDueInPeriod.byCurrency)}</dd></div>
          <div><dt className="text-muted-foreground">Open deals past their expected date</dt><dd className="font-medium tabular-nums">{e.openPastExpectedDate}</dd></div>
          <div><dt className="text-muted-foreground">Won on or before expected date</dt><dd className="font-medium tabular-nums">{e.wonWithExpectedDate ? `${e.wonOnOrBeforeExpectedDate} of ${e.wonWithExpectedDate} (${formatPercent(e.onTimeRate)})` : '—'}</dd></div>
        </dl>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Deals by stage" description="Open deals now, plus deals won or lost in the period."><DistributionChart title="Deals by stage" items={stageItems} noun="Deals" /></ChartCard>
        <ChartCard title="Deal value by stage" description={`${cur} only.${otherStageCurrencies.length ? ` Other currencies (${otherStageCurrencies.join(', ')}) are not converted.` : ''}`}>
          <GroupedBarChart title="Deal value by stage" rows={d.byStage.map((x) => ({ name: labelOf(x.stage), value: fromMinorUnits(amountFor(x.values, cur), cur) }))} bars={[{ key: 'value', label: 'Value' }]} valueFormatter={(n) => wholeCurrency(Math.round(n * 100), cur)} />
        </ChartCard>
        <ChartCard title="Won vs lost deals"><DistributionChart title="Won vs lost deals" items={outcome} variant="donut" colors={OUTCOME_COLORS} noun="Deals" /></ChartCard>
        <ChartCard title="Deal type distribution" description="Deals created in the period."><DistributionChart title="Deal type distribution" items={typeItems} variant="donut" noun="Deals" /></ChartCard>
        <ChartCard title="Deal creation and wins"><TrendChart title="Deals created and won" series={d.series.filter((x) => x.unit === 'count')} groupBy={meta.groupBy} /></ChartCard>
        <ChartCard title="Won deal value trend"><MoneyTrendChart title="Won deal value" series={d.series.find((x) => x.key === 'dealsWonValue')} currency={cur} groupBy={meta.groupBy} /></ChartCard>
        <ChartCard title="Sales performance by agent" description="Current assignee. Open = right now; won and lost = closed in the period. Listed alphabetically, not ranked." className="lg:col-span-2">
          <GroupedBarChart title="Sales performance by agent" rows={agents.map((a) => ({ name: a.name, open: a.open, won: a.won, lost: a.lost }))} bars={[{ key: 'open', label: 'Open' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' }]} />
          <div className="mt-4 overflow-x-auto">
            <SimpleTable
              caption="Sales performance by agent"
              rows={agents}
              getKey={(r, i) => `${r.userId ?? 'none'}-${i}`}
              columns={[
                { header: 'Agent', cell: (r) => r.name },
                { header: 'Open', cell: (r) => r.open, className: NUM },
                { header: 'Won', cell: (r) => r.won, className: NUM },
                { header: 'Lost', cell: (r) => r.lost, className: NUM },
                { header: 'Win rate', cell: (r) => formatPercent(r.winRate), className: NUM },
                { header: 'Won deal value', cell: (r) => formatMoneyList(r.wonValue), className: NUM },
              ]}
            />
          </div>
        </ChartCard>
      </div>
    </Fade>
  );
}