import { formatYmd } from '@/lib/datetime';
import { formatNumber } from '@/lib/format';
import { humanize, leadSourceLabels } from '@/lib/labels';
import { formatMinor } from '@/lib/money';
import type { Comparison, GroupBy, Kpi } from '@/types/analytics';

export type MetricKind = 'count' | 'rate' | 'money';

export const labelOf = (key: string) => (leadSourceLabels as Record<string, string>)[key] ?? humanize(key);

export const formatPercent = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
export const formatDays = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} ${v === 1 ? 'day' : 'days'}`);

export type Amount = { currency: string; amount: number };
export const amountFor = (items: Amount[] | undefined, currency: string) => items?.find((i) => i.currency === currency)?.amount ?? 0;
/** Currencies are never summed together: every currency is listed on its own. */
export const formatMoneyList = (items: Amount[], empty = '—') =>
  items.length ? items.map((i) => formatMinor(i.amount, i.currency)).join(' · ') : empty;

const SHORT = { month: 'short', day: 'numeric' } as const;

export function bucketLabel(bucket: string, groupBy: GroupBy) {
  switch (groupBy) {
    case 'year':
      return bucket.slice(0, 4);
    case 'month':
      return formatYmd(bucket, { month: 'short', year: 'numeric' });
    case 'week':
      return `Wk of ${formatYmd(bucket, SHORT)}`;
    default:
      return formatYmd(bucket, SHORT);
  }
}

export const rangeText = (r: { from: string; to: string }) => `${formatYmd(r.from, SHORT)} – ${formatYmd(r.to, { ...SHORT, year: 'numeric' })}`;

export interface ChangeView {
  kind: 'up' | 'down' | 'flat' | 'new' | 'unknown';
  text: string;
  srLabel: string;
}

/** Never shows Infinity or a fake percentage: a zero previous period is "New", rates change in percentage points. */
export function describeChange(c: Comparison | null, kind: MetricKind = 'count'): ChangeView | null {
  if (!c) return null;
  if (c.direction === 'unknown') return { kind: 'unknown', text: 'Not enough data to compare', srLabel: '' };
  if (kind === 'rate' && c.changePoints !== null) {
    if (c.changePoints === 0) return { kind: 'flat', text: 'No change', srLabel: '' };
    const up = c.changePoints > 0;
    return { kind: up ? 'up' : 'down', text: `${Math.abs(c.changePoints)} pts`, srLabel: up ? 'Up ' : 'Down ' };
  }
  if (c.direction === 'new') return { kind: 'new', text: 'New — nothing in the previous period', srLabel: '' };
  if (c.direction === 'flat') return { kind: 'flat', text: 'No change', srLabel: '' };
  const magnitude = c.changePct !== null ? `${Math.abs(c.changePct)}%` : c.direction === 'up' ? 'Up' : 'Down';
  return { kind: c.direction, text: magnitude, srLabel: c.direction === 'up' ? 'Up ' : 'Down ' };
}

export function previousText(c: Comparison | null, kind: MetricKind, currency: string) {
  if (!c || c.previous === null) return null;
  const v = kind === 'rate' ? `${c.previous}%` : kind === 'money' ? formatMinor(c.previous, currency) : formatNumber(c.previous);
  return `vs ${v} in the previous period`;
}

/** Props for MetricCard's comparison area. */
export const cmp = (c: Comparison | null, kind: MetricKind, currency: string, showComparison: boolean) => ({
  comparison: c,
  kind,
  showComparison,
  previous: previousText(c, kind, currency),
});

export function formatKpiValue(k: Kpi, currency: string) {
  if (k.value === null) return '—';
  if (k.kind === 'money') return formatMinor(k.value, currency);
  if (k.kind === 'rate') return `${k.value}%`;
  return formatNumber(k.value);
}

export function kpiProps(k: Kpi, currency: string, showComparison: boolean) {
  const others = (k.amounts ?? []).filter((a) => a.currency !== currency && a.amount !== 0);
  return {
    label: k.label,
    value: formatKpiValue(k, currency),
    description: k.description,
    snapshot: k.period === 'snapshot',
    ...cmp(k.comparison, k.kind, currency, showComparison),
    extra: others.length ? `Also: ${formatMoneyList(others)}` : undefined,
    emptyHint: k.kind === 'rate' && k.value === null ? 'No data in this period' : undefined,
  };
}

export const toDistribution = (rows: Array<{ key: string; count: number }>): Array<{ key: string; count: number; share: number }> => {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0 }));
};