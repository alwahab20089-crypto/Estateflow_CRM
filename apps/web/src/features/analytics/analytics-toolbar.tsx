import { FilterSelect } from '@/components/common/filter-select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MemberOption } from '@/types/leads';
import type { AnalyticsMeta } from '@/types/analytics';
import { rangeText } from './analytics-format';
import { GROUPINGS, type AnalyticsFilters } from './analytics-params';
import { DateRangeControl } from './date-range-control';

interface Props {
  filters: AnalyticsFilters;
  update: (patch: Record<string, string | undefined>) => void;
  meta?: AnalyticsMeta;
  teamWide: boolean;
  members: MemberOption[];
}

export function AnalyticsToolbar({ filters, update, meta, teamWide, members }: Props) {
  const memberOptions = [
    { value: 'me', label: 'My records' },
    { value: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({ value: m.userId, label: m.name })),
  ];

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <DateRangeControl value={filters} onChange={update} />
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect label="Grouping" allLabel="Auto grouping" value={filters.groupBy} options={GROUPINGS} onChange={(v) => update({ groupBy: v })} className="w-full sm:w-36" />
          {teamWide && (
            <FilterSelect label="Team member" allLabel="Whole organization" value={filters.assignedTo} options={memberOptions} onChange={(v) => update({ assignedTo: v })} className="w-full sm:w-48" />
          )}
          <div className="flex items-center gap-2">
            <Switch id="compare-previous" checked={filters.compare} onCheckedChange={(on) => update({ compare: on ? undefined : 'off' })} />
            <Label htmlFor="compare-previous">Compare to previous period</Label>
          </div>
        </div>
      </div>
      {meta && (
        <p className="text-caption">
          Showing {rangeText(meta.range)} ({meta.range.days} days)
          {filters.compare && <> · compared with {rangeText(meta.previousRange)}</>} · {meta.timezone} · {meta.scope === 'self' ? 'Your records only' : 'Whole organization'}
        </p>
      )}
    </div>
  );
}