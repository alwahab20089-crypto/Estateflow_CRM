// src/features/deals/deal-detail-page.tsx
import { ArrowLeft, Pencil, RotateCcw, Trash2, Trophy, UserCheck, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityList } from '@/features/properties/activity-list';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { formatMinor } from '@/lib/money';
import { useAuth } from '@/providers/auth-provider';
import type { DealStage } from '@/types/deals';
import { allowedStageMoves, canCloseWon, DEAL_STAGES, isTerminal, stageLabel } from './deal-constants';
import { AssignDealDialog, CloseLostDialog, CloseWonDialog, ReopenDealDialog } from './deal-dialogs';
import { DealFormDialog } from './deal-form-dialog';
import { useDeal, useDealActivities, useDeleteDeal, useUpdateDealStage } from './use-deals';
import { RelatedTasksCard } from '@/features/tasks/related-tasks-card';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-caption">{label}</dt><dd className="mt-0.5 break-words text-sm">{children || '—'}</dd></div>;
}
type Dlg = 'edit' | 'assign' | 'won' | 'lost' | 'reopen' | null;

export function DealDetailPage() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: deal, isLoading, isError, error, refetch } = useDeal(dealId);
  const activities = useDealActivities(dealId ?? '', 30);
  const move = useUpdateDealStage();
  const remove = useDeleteDeal();
  const [dialog, setDialog] = useState<Dlg>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return <div aria-busy="true" aria-label="Loading deal" className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80" /><Skeleton className="h-80 lg:col-span-2" /></div></div>;
  }
  if (isError || !deal) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <EmptyState title="Deal not found" description="It may have been archived, or you may not have access to it." action={<Button asChild variant="outline"><Link to="/app/pipeline">Back to pipeline</Link></Button>} />
    ) : (
      <ErrorState message={errorMessage(error, 'We could not load this deal.')} onRetry={() => refetch()} />
    );
  }

  const closed = isTerminal(deal.stage);
  const canUpdate = can('deals:update') && !closed;
  const options = DEAL_STAGES.filter((s) => s.value === deal.stage || allowedStageMoves(deal.stage).includes(s.value));

  const onStage = async (to: DealStage) => {
    if (to === deal.stage) return;
    try {
      await move.mutateAsync({ id: deal._id, stage: to });
      toast.success(`Moved to ${stageLabel(to)}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the stage'));
    }
  };
  const onDelete = async () => {
    try {
      await remove.mutateAsync(deal._id);
      toast.success('Deal archived');
      navigate('/app/pipeline', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not archive the deal'));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/app/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Pipeline</Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-page-title">{deal.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={deal.stage} />
            <Badge variant="outline">{deal.dealType.toLowerCase()}</Badge>
            <Badge variant="secondary">{deal.probability}% likely</Badge>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMinor(deal.valueAmount, deal.currency)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canUpdate && (
            <Select value={deal.stage} onValueChange={(v) => onStage(v as DealStage)}>
              <SelectTrigger aria-label="Change stage" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {canUpdate && canCloseWon(deal.stage) && <Button onClick={() => setDialog('won')}><Trophy /> Close as won</Button>}
          {canUpdate && <Button variant="outline" onClick={() => setDialog('lost')}><XCircle /> Close as lost</Button>}
          {canUpdate && <Button variant="outline" onClick={() => setDialog('edit')}><Pencil /> Edit</Button>}
          {can('deals:assign') && !closed && <Button variant="outline" onClick={() => setDialog('assign')}><UserCheck /> Reassign</Button>}
          {closed && can('deals:reopen') && <Button onClick={() => setDialog('reopen')}><RotateCcw /> Reopen</Button>}
          {can('deals:delete') && deal.stage !== 'WON' && <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 /> Archive</Button>}
        </div>
      </div>

      {closed && (
        <div role="status" className="rounded-md bg-muted px-4 py-3 text-sm">
          {deal.stage === 'WON' ? `Won${deal.actualClosingDate ? ` on ${formatDate(deal.actualClosingDate)}` : ''}. Closed deals are read-only until reopened.` : `Lost${deal.lostReason ? `: ${deal.lostReason}` : ''}. Closed deals are read-only until reopened.`}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-section-title">Linked records</CardTitle></CardHeader>

            <CardContent><dl className="space-y-3">
              <Field label="Contact">{deal.contact && <Link className="hover:underline" to={`/app/contacts/${deal.contact._id}`}>{deal.contact.fullName}</Link>}</Field>
              <Field label="Lead">{deal.lead && <Link className="hover:underline" to={`/app/leads/${deal.lead._id}`}>{deal.lead.name}</Link>}</Field>
              <Field label="Property">{deal.property && <span className="flex items-center gap-2"><Link className="hover:underline" to={`/app/properties/${deal.property._id}`}>{deal.property.title}</Link><StatusBadge status={deal.property.propertyStatus} /></span>}</Field>
            </dl></CardContent>
          </Card>
<RelatedTasksCard entityType="DEAL" entityId={deal._id} entityLabel={deal.title} />
          <Card>
            <CardHeader><CardTitle className="text-section-title">Deal details</CardTitle></CardHeader>
            <CardContent><dl className="space-y-3">
              <Field label="Stage">{stageLabel(deal.stage)}</Field>
              <Field label="Assigned agent">{deal.assignee?.name ?? 'Unassigned'}</Field>
              <Field label="Expected closing">{deal.expectedClosingDate && formatDate(deal.expectedClosingDate)}</Field>
              <Field label="Actual closing">{deal.actualClosingDate && formatDate(deal.actualClosingDate)}</Field>
              <Field label="Created">{formatDate(deal.createdAt)}</Field>
              <Field label="Notes"><span className="whitespace-pre-wrap">{deal.notes}</span></Field>
            </dl></CardContent>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-section-title">Activity</CardTitle></CardHeader>
          <CardContent><ActivityList items={activities.data?.data} isLoading={activities.isLoading} isError={activities.isError} onRetry={() => activities.refetch()} /></CardContent>
        </Card>
      </div>

      <DealFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} deal={deal} />
      <AssignDealDialog deal={dialog === 'assign' ? deal : null} onOpenChange={(o) => !o && setDialog(null)} />
      <CloseWonDialog deal={dialog === 'won' ? deal : null} onOpenChange={(o) => !o && setDialog(null)} />
      <CloseLostDialog deal={dialog === 'lost' ? deal : null} onOpenChange={(o) => !o && setDialog(null)} />
      <ReopenDealDialog deal={dialog === 'reopen' ? deal : null} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Archive this deal?" description="The deal is archived, not erased. Won deals cannot be archived." confirmLabel="Archive deal" destructive onConfirm={onDelete} />
    </div>
  );
}