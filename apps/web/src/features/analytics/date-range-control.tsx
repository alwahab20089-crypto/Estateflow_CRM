import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTimezone } from '@/hooks/use-timezone';
import { addDays, ymdInTz } from '@/lib/datetime';
import type { AnalyticsPeriod } from '@/types/analytics';
import { PERIODS, rangeError, type DateRangeValue } from './analytics-params';

export function DateRangeControl({ value, onChange }: { value: DateRangeValue; onChange: (patch: Record<string, string | undefined>) => void }) {
  const tz = useTimezone();
  const error = rangeError(value);

  const pick = (period: AnalyticsPeriod) => {
    if (period === 'custom') {
      const today = ymdInTz(new Date(), tz);
      onChange({ period, from: value.from ?? addDays(today, -29), to: value.to ?? today });
    } else onChange({ period });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Date range" className="inline-flex flex-wrap gap-0.5 rounded-lg border p-0.5">
          {PERIODS.map((p) => (
            <Button key={p.value} type="button" size="sm" variant={value.period === p.value ? 'default' : 'ghost'} aria-pressed={value.period === p.value} onClick={() => pick(p.value)}>
              {p.label}
            </Button>
          ))}
        </div>
        {value.period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="From date" className="w-40" value={value.from ?? ''} onChange={(e) => onChange({ period: 'custom', from: e.target.value || undefined, to: value.to })} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" className="w-40" value={value.to ?? ''} onChange={(e) => onChange({ period: 'custom', from: value.from, to: e.target.value || undefined })} />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}