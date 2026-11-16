import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Comparison } from '@/types/analytics';
import { describeChange, type MetricKind } from './analytics-format';

export interface MetricCardProps {
  label: string;
  value: string;
  description?: string;
  kind?: MetricKind;
  comparison?: Comparison | null;
  /** Right-now numbers have no history, so they never show a comparison. */
  snapshot?: boolean;
  showComparison?: boolean;
  previous?: string | null;
  extra?: string;
  emptyHint?: string;
  icon?: LucideIcon;
  compact?: boolean;
  positiveIsGood?: boolean;
}

const tones = { good: 'bg-success/10 text-success', bad: 'bg-destructive/10 text-destructive', neutral: 'bg-muted text-muted-foreground' };

export function MetricCard({
  label, value, description, kind = 'count', comparison = null, snapshot = false, showComparison = true, previous, extra, emptyHint, icon: Icon, compact = false, positiveIsGood = true,
}: MetricCardProps) {
  const change = !snapshot && showComparison ? describeChange(comparison, kind) : null;
  const tone = change?.kind === 'up' ? (positiveIsGood ? 'good' : 'bad') : change?.kind === 'down' ? (positiveIsGood ? 'bad' : 'good') : 'neutral';
  const ChangeIcon = change?.kind === 'up' ? TrendingUp : change?.kind === 'down' ? TrendingDown : change && change.kind !== 'unknown' ? Minus : null;

  return (
    <Card role="group" aria-label={label} className="gap-3 py-5">
      <CardContent className="space-y-2.5 px-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {emptyHint && <p className="text-caption">{emptyHint}</p>}
        {extra && <p className="text-caption">{extra}</p>}
        {snapshot ? (
          <p className="text-xs text-muted-foreground">Current snapshot</p>
        ) : change ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', tones[tone])}>
              {ChangeIcon && <ChangeIcon className="size-3" aria-hidden />}
              {change.srLabel && <span className="sr-only">{change.srLabel}</span>}
              {change.text}
            </span>
            {previous && <span className="text-muted-foreground">{previous}</span>}
          </div>
        ) : null}
        {!compact && description && <p className="text-caption">{description}</p>}
      </CardContent>
    </Card>
  );
}