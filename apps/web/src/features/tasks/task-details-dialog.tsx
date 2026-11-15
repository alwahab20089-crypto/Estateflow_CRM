import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityList } from '@/features/properties/activity-list';
import { useTimezone } from '@/hooks/use-timezone';
import { errorMessage } from '@/lib/errors';
import { formatFullTz } from '@/lib/datetime';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { isOpenStatus, RELATED_LABELS, relatedPath } from './task-constants';
import type { TaskActions } from './task-actions';
import { useTask, useTaskActivities } from './use-tasks';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-caption">{label}</dt><dd className="mt-0.5 break-words text-sm">{children || '—'}</dd></div>;
}

export function TaskDetailsDialog({ taskId, onClose, actions }: { taskId: string | null; onClose: () => void; actions: TaskActions }) {
  const { can } = useAuth();
  const tz = useTimezone();
  const query = useTask(taskId ?? undefined);
  const activities = useTaskActivities(taskId ?? '', 30, can('activities:read'));
  const task = query.data;
  const open = !!task && isOpenStatus(task.status);
  const act = (fn: () => void) => () => { fn(); };

  return (
    <Dialog open={taskId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task?.title ?? 'Task details'}</DialogTitle>
          <DialogDescription>{task ? `${humanize(task.taskType)} task` : 'Loading task…'}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div role="status" aria-label="Loading task" className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-32" /></div>
        ) : query.isError || !task ? (
          <ErrorState title="Task unavailable" message={errorMessage(query.error, 'This task was not found or you do not have access to it.')} onRetry={() => query.refetch()} />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <StatusBadge status={task.priority} />
              {task.isOverdue && <StatusBadge status="OVERDUE" className="bg-destructive/10 text-destructive" />}
            </div>
            {task.description && <p className="whitespace-pre-wrap text-sm">{task.description}</p>}

            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Due">{task.dueAt && <time dateTime={task.dueAt}>{formatFullTz(task.dueAt, tz)}</time>}</Field>
              <Field label="Reminder">
                {task.reminderAt && (<><time dateTime={task.reminderAt}>{formatFullTz(task.reminderAt, tz)}</time> · {humanize(task.reminderStatus)}</>)}
              </Field>
              <Field label="Assigned to">{task.assignee?.name ?? 'Unassigned'}</Field>
              <Field label="Created by">{task.creator?.name}</Field>
              <Field label="Related record">
                {task.related && <Link className="text-primary hover:underline" to={relatedPath(task.related.type, task.related._id)}>{RELATED_LABELS[task.related.type]}: {task.related.label}</Link>}
              </Field>
              <Field label="Tags">{task.tags.join(', ')}</Field>
              <Field label="Completed">{task.completedAt && formatFullTz(task.completedAt, tz)}</Field>
              <Field label="Created"><time dateTime={task.createdAt}>{formatFullTz(task.createdAt, tz)}</time></Field>
              <Field label="Last updated"><time dateTime={task.updatedAt}>{formatFullTz(task.updatedAt, tz)}</time></Field>
            </dl>

            <div className="flex flex-wrap gap-2">
              {can('tasks:update') && open && <Button onClick={act(() => actions.complete(task))}>Complete</Button>}
              {can('tasks:update') && !open && <Button onClick={act(() => actions.reopen(task))}>Reopen</Button>}
              {can('tasks:update') && open && <Button variant="outline" onClick={act(() => actions.edit(task))}>Edit</Button>}
              {can('tasks:assign') && <Button variant="outline" onClick={act(() => actions.assign(task))}>Reassign</Button>}
              {can('tasks:update') && open && <Button variant="outline" onClick={act(() => actions.cancel(task))}>Cancel task</Button>}
              {can('tasks:delete') && <Button variant="outline" onClick={act(() => actions.archive(task))}>Archive</Button>}
            </div>

            {can('activities:read') && (
              <section aria-labelledby="task-activity">
                <h3 id="task-activity" className="text-section-title mb-3">Activity</h3>
                <ActivityList items={activities.data?.data} isLoading={activities.isLoading} isError={activities.isError} onRetry={() => activities.refetch()} />
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}