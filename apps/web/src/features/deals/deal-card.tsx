// src/features/deals/deal-card.tsx
import { CalendarDays, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserAvatar } from '@/components/common/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import { formatMinor } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { DealDto, DealStage } from '@/types/deals';
import { allowedStageMoves, canCloseWon, DEAL_STAGES, isTerminal, stageLabel } from './deal-constants';

interface Props {
  deal: DealDto;
  canMove: boolean;
  onMove: (deal: DealDto, to: DealStage) => void;
  draggable: boolean;
  onDragStart: (deal: DealDto) => void;
}

export function DealCard({ deal, canMove, onMove, draggable, onDragStart }: Props) {
  // Selector options: moves the server allows, plus the two close actions. Closing opens a dialog first.
  const options: DealStage[] = [deal.stage, ...allowedStageMoves(deal.stage), ...(canCloseWon(deal.stage) ? (['WON'] as DealStage[]) : []), ...(isTerminal(deal.stage) ? [] : (['LOST'] as DealStage[]))];
  const ordered = DEAL_STAGES.filter((s) => options.includes(s.value));

  return (
    <article
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', deal._id); e.dataTransfer.effectAllowed = 'move'; onDragStart(deal); }}
      className={cn('space-y-2 rounded-lg border bg-card p-3 shadow-xs', draggable && 'cursor-grab active:cursor-grabbing')}
      aria-label={`Deal: ${deal.title}`}
    >
      <Link to={`/app/pipeline/${deal._id}`} className="block text-sm font-medium hover:underline">{deal.title}</Link>
      <p className="text-sm text-muted-foreground">{deal.contact?.fullName ?? 'Unknown contact'}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Home className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{deal.property?.title ?? 'Unknown property'}</span></p>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{formatMinor(deal.valueAmount, deal.currency)}</span>
        <Badge variant="outline">{deal.dealType.toLowerCase()}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {deal.assignee ? <><UserAvatar name={deal.assignee.name} className="size-5 text-[10px]" /><span className="max-w-24 truncate">{deal.assignee.name}</span></> : 'Unassigned'}
        </span>
        {deal.expectedClosingDate && <span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{formatDate(deal.expectedClosingDate)}</span>}
      </div>
      {canMove && !isTerminal(deal.stage) ? (
        <Select value={deal.stage} onValueChange={(v) => onMove(deal, v as DealStage)}>
          <SelectTrigger size="sm" className="w-full" aria-label={`Move ${deal.title}`}><SelectValue /></SelectTrigger>
          <SelectContent>{ordered.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">Stage: {stageLabel(deal.stage)}</p>
      )}
    </article>
  );
}