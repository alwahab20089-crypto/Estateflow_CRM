// src/features/deals/pipeline-page.tsx
import { Columns3, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/features/leads/use-leads';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { errorMessage } from '@/lib/errors';
import { formatMinor } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { DealDto, DealStage } from '@/types/deals';
import { allowedStageMoves, canCloseWon, DEAL_STAGES, OPEN_STAGES, stageLabel } from './deal-constants';
import { DealCard } from './deal-card';
import { CloseLostDialog, CloseWonDialog } from './deal-dialogs';
import { DealFormDialog } from './deal-form-dialog';
import { useDealFilters } from './use-deal-filters';
import { useDeals, useUpdateDealStage } from './use-deals';
const EMPTY_DEALS: DealDto[] = [];

export function PipelinePage() {
  const { can } = useAuth();
  const { filters, update, clear, hasActiveFilters } = useDealFilters();
  const query = useDeals(filters);
  const move = useUpdateDealStage();
  const members = useMembers(can('deals:read_all') && can('members:read'));
  const [formOpen, setFormOpen] = useState(false);
  const [won, setWon] = useState<DealDto | null>(null);
  const [lost, setLost] = useState<DealDto | null>(null);
  const [dragged, setDragged] = useState<DealDto | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);

  const [search, setSearch] = useState(filters.search ?? '');
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced.trim() !== (filters.search ?? '')) update({ search: debounced.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const deals = query.data?.data ?? EMPTY_DEALS;
  const meta = query.data?.meta;
  const canMove = can('deals:update');
  const columns = filters.stage ? DEAL_STAGES.filter((s) => s.value === filters.stage) : DEAL_STAGES;

  const byStage = useMemo(() => {
    const map = new Map<DealStage, DealDto[]>();
    for (const d of deals) map.set(d.stage, [...(map.get(d.stage) ?? []), d]);
    return map;
  }, [deals]);

  // Counts and totals come from the server summary, so they stay right even when the board is truncated.
  const counts = new Map<DealStage, number>();
  const activeValue = new Map<string, number>();
  for (const s of meta?.summary ?? []) {
    counts.set(s.stage, (counts.get(s.stage) ?? 0) + s.count);
    if (OPEN_STAGES.includes(s.stage)) activeValue.set(s.currency, (activeValue.get(s.currency) ?? 0) + s.totalAmount);
  }
  const activeCount = OPEN_STAGES.reduce((a, s) => a + (counts.get(s) ?? 0), 0);

  const requestMove = async (deal: DealDto, to: DealStage) => {
    if (to === deal.stage) return;
    if (to === 'WON') return canCloseWon(deal.stage) ? setWon(deal) : void toast.error('Move the deal to Negotiation or Contract before closing it as won.');
    if (to === 'LOST') return void setLost(deal);
    if (!allowedStageMoves(deal.stage).includes(to)) return void toast.error(`A deal cannot move from ${stageLabel(deal.stage)} to ${stageLabel(to)}.`);
    try {
      await move.mutateAsync({ id: deal._id, stage: to }); // optimistic; rolled back if the server refuses
      toast.success(`Moved to ${stageLabel(to)}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the stage'));
    }
  };

  const showError = query.isError && !query.data;
  const showEmpty = !query.isLoading && !showError && deals.length === 0;

  return (
    <>
      <PageHeader
        title="Sales pipeline"
        description={query.isLoading ? 'Loading deals…' : `${activeCount} active ${activeCount === 1 ? 'deal' : 'deals'}${[...activeValue].length ? ' · ' + [...activeValue].map(([c, v]) => formatMinor(v, c, true)).join(' + ') + ' in play' : ''}`}
        actions={can('deals:create') && <Button onClick={() => setFormOpen(true)}><Plus /> New deal</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search deals…" label="Search deals" className="lg:w-72" />
        <Select value={filters.stage ?? 'ALL'} onValueChange={(v) => update({ stage: v === 'ALL' ? undefined : v })}>
          <SelectTrigger aria-label="Stage filter" className="w-full lg:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All stages</SelectItem>{DEAL_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.dealType ?? 'ALL'} onValueChange={(v) => update({ dealType: v === 'ALL' ? undefined : v })}>
          <SelectTrigger aria-label="Deal type filter" className="w-full lg:w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All types</SelectItem>{['SALE', 'RENT', 'LEASE'].map((t) => <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
        </Select>
        {can('deals:read_all') && can('members:read') && (
          <Select value={filters.assignedTo ?? 'ALL'} onValueChange={(v) => update({ assignedTo: v === 'ALL' ? undefined : v })}>
            <SelectTrigger aria-label="Agent filter" className="w-full lg:w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All agents</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>{(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {hasActiveFilters && <Button variant="ghost" onClick={() => { clear(); setSearch(''); }}>Clear filters</Button>}
      </div>

      {meta && meta.total > deals.length && <p role="status" className="mb-3 text-sm text-muted-foreground">Showing the newest {deals.length} of {meta.total} deals. Narrow the filters to see the rest. Column counts cover all of them.</p>}

      {showError ? (
        <ErrorState message={errorMessage(query.error, 'We could not load the pipeline.')} onRetry={() => query.refetch()} />
      ) : showEmpty ? (
        hasActiveFilters ? (
          <EmptyState icon={Columns3} title="No deals match your filters" description="Try a different search or clear the filters." action={<Button variant="outline" onClick={() => { clear(); setSearch(''); }}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={Columns3} title="No deals yet" description="Create a deal to connect a contact with a property and track it to the close." action={can('deals:create') ? <Button onClick={() => setFormOpen(true)}><Plus /> New deal</Button> : undefined} />
        )
      ) : query.isLoading ? (
        <div role="status" aria-label="Loading pipeline" className="flex gap-4 overflow-x-auto pb-2">
          {columns.map((c) => <Skeleton key={c.value} className="h-96 w-72 shrink-0" />)}
        </div>
      ) : (
        <div aria-busy={query.isFetching} className={cn('flex items-start gap-4 overflow-x-auto pb-4', query.isPlaceholderData && 'opacity-60 transition-opacity')}>
          {columns.map((col) => {
            const items = byStage.get(col.value) ?? [];
            const colValue = (meta?.summary ?? []).filter((s) => s.stage === col.value);
            return (
              <section key={col.value} aria-label={col.label}
                onDragOver={(e) => { if (canMove && dragged) { e.preventDefault(); setOverStage(col.value); } }}
                onDragLeave={() => setOverStage((s) => (s === col.value ? null : s))}
                onDrop={(e) => { e.preventDefault(); setOverStage(null); if (dragged) void requestMove(dragged, col.value); setDragged(null); }}
                className={cn('w-72 shrink-0 rounded-xl bg-muted/50 p-3', overStage === col.value && 'ring-2 ring-primary')}>
                <header className="mb-3">
                  <h2 className="text-sm font-semibold">{col.label} <span className="ml-1 rounded-full bg-background px-2 py-0.5 text-xs tabular-nums" aria-label={`${counts.get(col.value) ?? 0} deals`}>{counts.get(col.value) ?? 0}</span></h2>
                  {colValue.length > 0 && <p className="text-caption tabular-nums">{colValue.map((s) => formatMinor(s.totalAmount, s.currency, true)).join(' + ')}</p>}
                </header>
                <ul className="space-y-2">
                  {items.map((d) => (
                    <li key={d._id}><DealCard deal={d} canMove={canMove} onMove={requestMove} draggable={canMove && d.stage !== 'WON' && d.stage !== 'LOST'} onDragStart={setDragged} /></li>
                  ))}
                  {items.length === 0 && <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No deals</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <DealFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CloseWonDialog deal={won} onOpenChange={(o) => !o && setWon(null)} />
      <CloseLostDialog deal={lost} onOpenChange={(o) => !o && setLost(null)} />
    </>
  );
}