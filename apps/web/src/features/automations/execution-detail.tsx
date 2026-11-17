import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/error-state';
import { LoadingButton } from '@/components/common/loading-button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import type { ActionResult, ExecutionDto } from '@/types/automations';
import { ACTION_MAP, TRIGGER_MAP, describeAction } from './automation-catalog';
import { ExecutionStatusBadge, ResultIcon } from './automation-ui';
import { useExecution, useRetryExecution } from './use-automations';

/** Plain-language outcome, including notification delivery and the email provider's behaviour. */
export function resultNote(r: ActionResult): string {
  if (r.status === 'FAILED') return r.error ?? 'Failed';
  if (r.status === 'SKIPPED') return `Skipped: ${humanize(r.reason ?? 'not applicable')}`;
  if (r.status === 'PENDING') return 'Not run yet';
  const out = r.output ?? {};
  if (r.type === 'CREATE_IN_APP_NOTIFICATION') return out.created === false ? 'Not delivered (already delivered, or the recipient turned it off)' : 'Notification delivered';
  if (r.type === 'SEND_EMAIL_NOTIFICATION') return out.duplicate ? 'Already sent earlier: not sent again' : 'Email sent through the configured provider';
  return 'Done';
}

const FAILED = ['FAILED', 'PARTIALLY_FAILED'];

export function ExecutionDetail({ workflowId, executionId, onClose }: { workflowId: string; executionId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const q = useExecution(workflowId, executionId);
  const retry = useRetryExecution();
  const e: ExecutionDto | undefined = q.data;

  const doRetry = async () => {
    try { await retry.mutateAsync({ id: workflowId, executionId: executionId! }); toast.success('Retry queued. Only the failed actions will run again.'); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Sheet open={Boolean(executionId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Execution details</SheetTitle>
          <SheetDescription>{e ? TRIGGER_MAP[e.triggerType].label : 'Loading…'}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6 text-sm">
          {q.isLoading && <Skeleton className="h-40 w-full" />}
          {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
          {e && (
            <>
              <div className="flex items-center gap-2"><ExecutionStatusBadge status={e.status} /><span className="text-muted-foreground">Attempt {e.attemptCount} of {e.maxAttempts}{e.retryCount > 0 ? ` · retried manually ${e.retryCount}×` : ''}</span></div>
              {e.errorSummary && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">{e.errorSummary}</p>}
              {e.status === 'PENDING' && e.nextRetryAt && <p className="text-muted-foreground">Next attempt after {formatDateTime(e.nextRetryAt)}.</p>}
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">Triggered by</dt><dd>{String(e.payload?.name ?? '—')}</dd>
                <dt className="text-muted-foreground">Created</dt><dd>{formatDateTime(e.createdAt)}</dd>
                {e.completedAt && <><dt className="text-muted-foreground">Finished</dt><dd>{formatDateTime(e.completedAt)}</dd></>}
                <dt className="text-muted-foreground">Version</dt><dd>{e.workflowVersion}</dd>
              </dl>
              <section aria-label="Action results">
                <h3 className="mb-2 font-semibold">Actions</h3>
                <ol className="space-y-2">
                  {e.actionResults.map((r) => (
                    <li key={r.index} className="flex gap-2 rounded-md border p-3">
                      <ResultIcon status={r.status} />
                      <div className="min-w-0">
                        <p className="font-medium">{ACTION_MAP[r.type].label} <span className="font-normal text-muted-foreground">· {humanize(r.status)}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</span></p>
                        {e.actions?.[r.index] && <p className="text-muted-foreground">{describeAction(e.actions[r.index]!)}</p>}
                        <p className={r.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}>{resultNote(r)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              {FAILED.includes(e.status) && can('automations:retry') && (
                <LoadingButton loading={retry.isPending} onClick={doRetry}><RotateCcw className="mr-1 size-4" /> Retry failed actions</LoadingButton>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}