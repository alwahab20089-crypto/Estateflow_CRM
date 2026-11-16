import { ChartColumn } from 'lucide-react';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from '@/components/common/empty-state';
import { axisTick, chartColors, tooltipStyle } from '@/lib/chart';
import { formatCurrency, formatNumber } from '@/lib/format';
import { formatMinor, fromMinorUnits } from '@/lib/money';
import type { DistributionItem, GroupBy, Series } from '@/types/analytics';
import { bucketLabel, labelOf } from './analytics-format';

const colorAt = (i: number) => chartColors[i % chartColors.length]!;
const legendText = (value: string) => <span className="text-xs text-foreground">{value}</span>;

export function ChartEmpty({ message = 'No data for this period' }: { message?: string }) {
  return <EmptyState icon={ChartColumn} title={message} description="Try a wider date range or fewer filters." className="py-10" />;
}

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div style={tooltipStyle} className="space-y-0.5 px-3 py-2">
      {children}
    </div>
  );
}

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> };

/* ------------------------------------------------------------------ distribution */

interface DistRow extends DistributionItem { label: string; fill: string }

interface DistributionChartProps {
  title: string;
  items: DistributionItem[];
  variant?: 'bar' | 'donut';
  colors?: Record<string, string>;
  /** Hide categories with 0 records (default). Inventory-style charts keep them. */
  hideZero?: boolean;
  /** Keys are names (agents, cities): do not "humanize" them. */
  rawLabels?: boolean;
  noun?: string;
  height?: number;
}

export function DistributionChart({ title, items, variant = 'bar', colors, hideZero = true, rawLabels = false, noun = 'Records', height = 256 }: DistributionChartProps) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0) return <ChartEmpty />;

  const rows: DistRow[] = items
    .filter((i) => !hideZero || i.count > 0)
    .map((i, n) => ({ ...i, label: rawLabels ? i.key : labelOf(i.key), fill: colors?.[i.key] ?? colorAt(n) }));
  const summary = `${title}: ${rows.slice(0, 12).map((r) => `${r.label} ${r.count} (${r.share}%)`).join(', ')}`;

  const tooltip = (p: unknown) => {
    const { active, payload } = p as TipProps;
    const row = payload?.[0]?.payload as DistRow | undefined;
    if (!active || !row) return null;
    return (
      <TooltipBox>
        <p className="font-medium">{row.label}</p>
        <p>
          {formatNumber(row.count)} {noun.toLowerCase()} · {row.share}%
        </p>
      </TooltipBox>
    );
  };

  if (variant === 'donut') {
    return (
      <div className="grid items-center gap-4 sm:grid-cols-2">
        <div role="img" aria-label={summary} className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={tooltip} />
              <Pie data={rows} dataKey="count" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="var(--card)">
                {rows.map((r, n) => (
                  <Cell key={`${r.key}-${n}`} fill={r.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1.5 text-sm">
          {rows.map((r, n) => (
            <li key={`${r.key}-${n}`} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.fill }} aria-hidden />
                <span className="truncate">{r.label}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(r.count)} · {r.share}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div role="img" aria-label={summary} style={{ height: Math.max(height, rows.length * 34) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={116} tickLine={false} axisLine={false} tick={axisTick} interval={0} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} content={tooltip} />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
            {rows.map((r, n) => (
              <Cell key={`${r.key}-${n}`} fill={r.fill} />
            ))}
            <LabelList dataKey="count" position="right" fill="var(--foreground)" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ trends (counts) */

export function TrendChart({ series, groupBy, title, height = 288 }: { series: Series[]; groupBy: GroupBy; title: string; height?: number }) {
  const sums = series.map((s) => s.points.reduce((a, p) => a + p.value, 0));
  if (series.length === 0 || sums.every((n) => n === 0)) return <ChartEmpty message="No activity in this period" />;

  const lookups = series.map((s) => new Map(s.points.map((p) => [p.bucket, p.value])));
  const buckets = series[0]!.points.map((p) => p.bucket);
  const data = buckets.map((b) => ({
    label: bucketLabel(b, groupBy),
    ...Object.fromEntries(series.map((s, i) => [s.key, lookups[i]!.get(b) ?? 0])),
  }));
  const summary = `${title}: ${series.map((s, i) => `${s.label} ${sums[i]}`).join(', ')} across ${buckets.length} ${groupBy} periods`;

  return (
    <div role="img" aria-label={summary} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          {series.length > 1 && <Legend formatter={legendText} />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorAt(i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ trends (won deal value) */

export function MoneyTrendChart({ series, currency, groupBy, title, height = 288 }: { series: Series | undefined; currency: string; groupBy: GroupBy; title: string; height?: number }) {
  if (!series || !series.points.some((p) => (p.count ?? 0) > 0)) return <ChartEmpty message="No won deals in this period" />;

  const data = series.points.map((p) => ({
    label: bucketLabel(p.bucket, groupBy),
    major: fromMinorUnits(p.value, currency),
    minor: p.value,
    count: p.count ?? 0,
    byCurrency: p.byCurrency ?? {},
  }));
  const others = [...new Set(series.points.flatMap((p) => Object.keys(p.byCurrency ?? {})))].filter((c) => c !== currency).sort();
  const total = series.points.reduce((s, p) => s + p.value, 0);
  const summary = `${title}: ${formatMinor(total, currency)} won across ${series.points.length} ${groupBy} periods`;

  const tooltip = (p: unknown) => {
    const { active, payload } = p as TipProps;
    const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
    if (!active || !row) return null;
    return (
      <TooltipBox>
        <p className="font-medium">{row.label}</p>
        <p>
          {formatMinor(row.minor, currency)} · {row.count} won
        </p>
        {Object.entries(row.byCurrency)
          .filter(([c]) => c !== currency)
          .map(([c, amount]) => (
            <p key={c} className="text-muted-foreground">
              {formatMinor(amount, c)}
            </p>
          ))}
      </TooltipBox>
    );
  };

  return (
    <div className="space-y-2">
      <div role="img" aria-label={summary} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)} />
            <Tooltip cursor={{ fill: 'var(--muted)' }} content={tooltip} />
            <Bar dataKey="major" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-caption">
        Chart shows {currency}.{others.length > 0 ? ` Also won in ${others.join(', ')}: see the tables, currencies are never added together.` : ''} Agreed deal value, not cash collected.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ grouped bars (agents, stages) */

export function GroupedBarChart({
  title,
  rows,
  bars,
  valueFormatter = (n: number) => formatNumber(n),
}: {
  title: string;
  rows: Array<Record<string, string | number>>;
  bars: Array<{ key: string; label: string }>;
  valueFormatter?: (n: number) => string;
}) {
  const hasValue = rows.some((r) => bars.some((b) => Number(r[b.key]) > 0));
  if (rows.length === 0 || !hasValue) return <ChartEmpty />;

  const summary = `${title}: ${rows
    .slice(0, 12)
    .map((r) => `${r.name}: ${bars.map((b) => `${b.label} ${valueFormatter(Number(r[b.key]))}`).join(', ')}`)
    .join('; ')}`;

  return (
    <div role="img" aria-label={summary} style={{ height: Math.max(256, rows.length * (bars.length * 16 + 22)) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} allowDecimals={false} tickFormatter={(v: number) => valueFormatter(v)} />
          <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={axisTick} interval={0} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={tooltipStyle} formatter={(v) => valueFormatter(Number(v))} />
          {bars.length > 1 && <Legend formatter={legendText} />}
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} name={b.label} fill={colorAt(i)} radius={[0, 4, 4, 0]} barSize={12} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const wholeCurrency = (minor: number, currency: string) => formatCurrency(fromMinorUnits(minor, currency), currency);