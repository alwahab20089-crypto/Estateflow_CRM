import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isValidYmd, parseYmd } from '@/lib/datetime';
import type { AnalyticsPeriod, GroupBy, RangeParams } from '@/types/analytics';

export const MAX_RANGE_DAYS = 366;

export const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
  { value: 'custom', label: 'Custom' },
];
export const GROUPINGS: Array<{ value: GroupBy; label: string }> = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'year', label: 'By year' },
];
export const ANALYTICS_TABS = ['overview', 'leads', 'deals', 'properties', 'team', 'tasks', 'revenue'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export interface DateRangeValue { period: AnalyticsPeriod; from?: string; to?: string }
export interface AnalyticsFilters extends DateRangeValue {
  groupBy?: GroupBy;
  assignedTo?: string;
  compare: boolean;
  tab: AnalyticsTab;
}

const PERIOD_VALUES = PERIODS.map((p) => p.value);
const GROUP_VALUES = GROUPINGS.map((g) => g.value);
const OBJECT_ID = /^[a-f\d]{24}$/i;

export const oneOf = <T extends string>(v: string | null, list: readonly T[]): T | undefined =>
  v && (list as readonly string[]).includes(v) ? (v as T) : undefined;

export function daysInclusive(from: string, to: string) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

/** Same rules as the API, so an invalid range never reaches the network. */
export function rangeError(v: DateRangeValue): string | null {
  if (v.period !== 'custom') return null;
  if (!v.from || !v.to) return 'Choose both a start and an end date.';
  if (v.from > v.to) return '"To" must not be before "From".';
  if (daysInclusive(v.from, v.to) > MAX_RANGE_DAYS) return `The range may not exceed ${MAX_RANGE_DAYS} days.`;
  return null;
}

export function readDateRange(params: URLSearchParams): DateRangeValue {
  const period = oneOf(params.get('period'), PERIOD_VALUES) ?? '30d';
  if (period !== 'custom') return { period };
  const from = params.get('from');
  const to = params.get('to');
  return { period, from: isValidYmd(from) ? from : undefined, to: isValidYmd(to) ? to : undefined };
}

export function readAssignee(v: string | null): string | undefined {
  if (!v) return undefined;
  return v === 'me' || v === 'unassigned' || OBJECT_ID.test(v) ? v : undefined;
}

/** The API is strict: from/to only with period=custom, and no undefined keys. */
export function toRangeParams(f: { period: AnalyticsPeriod; from?: string; to?: string; groupBy?: GroupBy; assignedTo?: string }): RangeParams {
  return {
    period: f.period,
    ...(f.period === 'custom' ? { from: f.from, to: f.to } : {}),
    ...(f.groupBy ? { groupBy: f.groupBy } : {}),
    ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}),
  };
}

export function useAnalyticsFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<AnalyticsFilters>(
    () => ({
      ...readDateRange(params),
      groupBy: oneOf(params.get('groupBy'), GROUP_VALUES),
      assignedTo: readAssignee(params.get('assignedTo')),
      compare: params.get('compare') !== 'off',
      tab: oneOf(params.get('tab'), ANALYTICS_TABS) ?? 'overview',
    }),
    [params],
  );

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          if (patch.period && patch.period !== 'custom') {
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { filters, update };
}