import { Card, CardContent } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { humanize } from '@/lib/labels';
import { formatMinor } from '@/lib/money';
import { formatDays, labelOf } from '../analytics/analytics-format';

const LABELS: Record<string, string> = {
  newLeads: 'New leads', qualified: 'Qualified', converted: 'Converted', won: 'Won', lost: 'Lost', conversionRate: 'Conversion rate', qualifiedRate: 'Qualified rate',
  convertedInPeriod: 'Converted in period', avgDaysToConvert: 'Avg time to convert', openDeals: 'Open deals', pipelineValue: 'Pipeline value', wonValue: 'Won deal value',
  winRate: 'Win rate', avgDaysToClose: 'Avg time to close', cohort: 'Tasks in period', completedInPeriod: 'Completed in period', createdInPeriod: 'Created in period',
  matured: 'Past-due tasks (rate sample)', completionRate: 'Completion rate', onTimeRate: 'On-time rate',
};
const TEXT_KEYS = ['note', 'attribution', 'winRateDefinition'];
type Money = { currency: string; amount: number; count?: number };
const isMoneyList = (v: unknown): v is Money[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'currency' in x && 'amount' in x);

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="space-y-1 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-lg font-semibold tabular-nums">{children}</div>
      </CardContent>
    </Card>
  );
}

export function ReportSummary({ summary }: { summary: Record<string, unknown> }) {
  const tiles: Array<{ label: string; node: React.ReactNode }> = [];
  const texts: string[] = [];

  for (const [key, v] of Object.entries(summary)) {
    if (TEXT_KEYS.includes(key) && typeof v === 'string') texts.push(v);
    else if (key === 'totals' && v && typeof v === 'object') {
      const t = v as { total: number; active: number; available: number };
      tiles.push({ label: 'Total properties', node: formatNumber(t.total) }, { label: 'Active (on market)', node: formatNumber(t.active) }, { label: 'Available', node: formatNumber(t.available) });
    } else if (key === 'byStatus' && Array.isArray(v)) {
      tiles.push({ label: 'By status', node: <span className="text-sm font-normal">{(v as Array<{ key: string; count: number }>).map((s) => `${labelOf(s.key)} ${s.count}`).join(' · ') || '—'}</span> });
    } else if (key === 'averageListingPrice' && Array.isArray(v)) {
      const list = v as Array<{ currency: string; listingType: string; rentPeriod: string | null; count: number; average: number }>;
      tiles.push({ label: 'Average asking price (not revenue)', node: <span className="block space-y-0.5 text-sm font-normal">{list.length ? list.map((a, i) => <span key={i} className="block">{labelOf(a.listingType)}{a.rentPeriod ? ` / ${humanize(a.rentPeriod)}` : ''}: {formatMinor(a.average, a.currency)} ({a.count})</span>) : '—'}</span> });
    } else if (isMoneyList(v)) {
      tiles.push({ label: LABELS[key] ?? humanize(key), node: <span className="block space-y-0.5 text-sm">{v.length ? v.map((m) => <span key={m.currency} className="block">{formatMinor(m.amount, m.currency)}{m.count !== undefined ? ` (${m.count} deals)` : ''}</span>) : '—'}</span> });
    } else if (v === null || typeof v === 'number') {
      const label = LABELS[key] ?? humanize(key);
      const text = v === null ? '—' : /Rate$/.test(key) ? `${v}%` : key.startsWith('avgDays') ? formatDays(v) : formatNumber(v);
      tiles.push({ label, node: text });
    }
  }

  return (
    <section aria-label="Report summary" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Tile key={t.label} label={t.label}>{t.node}</Tile>
        ))}
      </div>
      {texts.map((t) => (
        <p key={t} className="text-caption">{t}</p>
      ))}
    </section>
  );
}