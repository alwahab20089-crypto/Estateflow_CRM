import {
  History,
  Pencil,
  Pause,
  Play,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
  FlaskConical,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { useFeature } from '@/features/license/use-license';
import type { WorkflowDto } from '@/types/automations';
import { TRIGGERS, TRIGGER_MAP } from './automation-catalog';
import { Pick, WorkflowStatusBadge } from './automation-ui';
import { TestWorkflowDialog } from './test-workflow-dialog';
import {
  useActivateWorkflow,
  usePauseWorkflow,
  useRemoveWorkflow,
  useWorkflows,
} from './use-automations';

const STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'PAUSED'].map((s) => ({
  value: s,
  label: s[0] + s.slice(1).toLowerCase(),
}));

export function AutomationsPage() {
  const { can } = useAuth();

  const licensed = useFeature('automations');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const [page, setPage] = useState(1);

  const [archiving, setArchiving] = useState<WorkflowDto | null>(null);
  const [testing, setTesting] = useState<WorkflowDto | null>(null);

  const search = useDebouncedValue(q.trim());

  const list = useWorkflows({
    page,
    limit: 20,
    q: search || undefined,
    status: status || undefined,
    triggerType: trigger || undefined,
  });

  const activate = useActivateWorkflow();
  const pause = usePauseWorkflow();
  const remove = useRemoveWorkflow();

  const filtered = Boolean(search || status || trigger);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <>
      <PageHeader
        title="Automations"
        description="Run follow-ups, assignments and notifications automatically when things happen in your CRM."
        actions={
          can('automations:create') &&
          (licensed.allowed ? (
            <Button asChild>
              <Link to="/app/automations/new">
                <Plus className="mr-1 size-4" />
                New automation
              </Link>
            </Button>
          ) : (
            <Button disabled title={licensed.reason}>
              <Plus className="mr-1 size-4" />
              New automation
            </Button>
          ))
        }
      />

      {!licensed.loading && !licensed.allowed && (
        <div
          role="status"
          className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          {licensed.reason} Your existing automations do not run until it is available again. You can
          still pause or archive them.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Search automations"
          placeholder="Search by name…"
          className="max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />

        <Pick
          aria-label="Filter by status"
          className="w-auto"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        />

        <Pick
          aria-label="Filter by trigger"
          className="w-auto"
          placeholder="All triggers"
          options={TRIGGERS.map((t) => ({
            value: t.value,
            label: t.label,
          }))}
          value={trigger}
          onChange={(e) => {
            setTrigger(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <Card>
        {list.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading automations">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title={filtered ? 'No automations match your filters' : 'No automations yet'}
            description={
              filtered
                ? 'Try a different search or clear the filters.'
                : 'Create your first automation to stop doing repetitive follow-ups by hand.'
            }
            action={
              !filtered && can('automations:create') && licensed.allowed ? (
                <Button asChild>
                  <Link to="/app/automations/new">New automation</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automation</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((w) => (
                <TableRow key={w._id}>
                  <TableCell>
                    <Link
                      to={`/app/automations/${w._id}/executions`}
                      className="font-medium hover:underline"
                    >
                      {w.name}
                    </Link>

                    {w.description && (
                      <p className="max-w-xs truncate text-xs text-muted-foreground">
                        {w.description}
                      </p>
                    )}
                  </TableCell>

                  <TableCell className="text-sm">
                    {TRIGGER_MAP[w.triggerType].label}
                  </TableCell>

                  <TableCell>
                    <WorkflowStatusBadge status={w.status} />
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {w.lastExecutedAt ? formatRelative(w.lastExecutedAt) : 'Never'}
                  </TableCell>

                  <TableCell className="text-sm">
                    {w.stats?.total ? (
                      <span>
                        {w.stats.total} total ·{' '}
                        <span className="text-success">{w.stats.completed} ok</span>
                        {w.stats.failed > 0 && (
                          <>
                            {' '}
                            ·{' '}
                            <span className="font-medium text-destructive">
                              {w.stats.failed} failed
                            </span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No runs</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {can('automations:activate') &&
                        (w.status === 'ACTIVE' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Pause ${w.name}`}
                            onClick={() =>
                              run(() => pause.mutateAsync(w._id), 'Automation paused')
                            }
                          >
                            <Pause className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Activate ${w.name}`}
                            disabled={!licensed.allowed}
                            title={licensed.reason}
                            onClick={() =>
                              run(() => activate.mutateAsync(w._id), 'Automation activated')
                            }
                          >
                            <Play className="size-4" />
                          </Button>
                        ))}

                      {can('automations:execute') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Test ${w.name}`}
                          disabled={!licensed.allowed}
                          title={licensed.reason}
                          onClick={() => setTesting(w)}
                        >
                          <FlaskConical className="size-4" />
                        </Button>
                      )}

                      {can('automations:execution_read') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          aria-label={`History for ${w.name}`}
                        >
                          <Link to={`/app/automations/${w._id}/executions`}>
                            <History className="size-4" />
                          </Link>
                        </Button>
                      )}

                      {can('automations:update') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          aria-label={`Edit ${w.name}`}
                        >
                          <Link to={`/app/automations/${w._id}/edit`}>
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                      )}

                      {can('automations:delete') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Archive ${w.name}`}
                          onClick={() => setArchiving(w)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {meta && meta.total > 0 && (
        <div className="mt-4">
          <Pagination
            page={meta.page}
            pageCount={meta.totalPages}
            total={meta.total}
            pageSize={meta.limit}
            onPageChange={setPage}
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(o) => !o && setArchiving(null)}
        destructive
        confirmLabel="Archive"
        title="Archive this automation?"
        description={`"${archiving?.name ?? ''}" will stop running and pending executions will be cancelled. History is kept for audit.`}
        onConfirm={() => {
          const w = archiving!;
          setArchiving(null);
          void run(() => remove.mutateAsync(w._id), 'Automation archived');
        }}
      />

      <TestWorkflowDialog workflow={testing} onClose={() => setTesting(null)} />
    </>
  );
}