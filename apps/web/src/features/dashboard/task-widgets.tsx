import { CheckCircle2, ListChecks, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AsyncCard } from '@/components/common/async-card';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { taskPath, TASK_TYPE_ICONS } from '@/features/tasks/task-constants';
import { useTaskSummary } from '@/features/tasks/use-tasks';
import { useTimezone } from '@/hooks/use-timezone';
import { addDays, formatDateTimeTz, startOfDayUtc, ymdInTz } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { TaskDto } from '@/types/tasks';

/** One summary request for all dashboard task widgets. The key changes only when the local day does. */
export function useDashboardTasks() {
  const { can } = useAuth();
  const tz = useTimezone();
  const today = ymdInTz(new Date(), tz);
  const params = useMemo(() => ({ dayStart: startOfDayUtc(today, tz).toISOString(), dayEnd: startOfDayUtc(addDays(today, 1), tz).toISOString(), scope: 'mine' as const }), [today, tz]);
  return { ...useTaskSummary(params, can('tasks:read')), tz, allowed: can('tasks:read') };
}

export function TaskList({ tasks, tz, emptyTitle, emptyDescription, showCompleted }: { tasks: TaskDto[]; tz: string; emptyTitle: string; emptyDescription: string; showCompleted?: boolean }) {
  if (tasks.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const Icon = TASK_TYPE_ICONS[t.taskType];
        const when = showCompleted ? t.completedAt : t.dueAt;
        return (
          <li key={t._id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-2">
              <Link to={taskPath(t._id)} className="flex min-w-0 items-start gap-2 text-sm font-medium hover:underline"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{t.title}</span></Link>
              <StatusBadge status={t.priority} />
            </div>
            <p className={cn('text-caption', t.isOverdue && 'text-destructive')}>
              {when && <time dateTime={when}>{formatDateTimeTz(when, tz)}</time>} · {t.assignee?.name ?? 'Unassigned'}{t.related ? ` · ${t.related.label}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function TaskWidgets() {
  const { data, isLoading, isError, refetch, tz, allowed } = useDashboardTasks();
  if (!allowed) return null;
  const common = { isLoading, isError, onRetry: () => refetch(), skeletonHeight: 'h-56' };
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AsyncCard title="My tasks" description={data ? `${data.myTasks.count} open` : 'Assigned to you'} {...common}>
        <TaskList tasks={data?.myTasks.items ?? []} tz={tz} emptyTitle="No open tasks" emptyDescription="Nothing is waiting on you." />
      </AsyncCard>
      <AsyncCard title="Due today" description={data ? `${data.dueToday.count} due` : undefined} {...common}>
        <TaskList tasks={data?.dueToday.items ?? []} tz={tz} emptyTitle="Nothing due today" emptyDescription="Enjoy the quiet." />
      </AsyncCard>
      <AsyncCard title="Overdue" description={data ? `${data.overdue.count} overdue` : undefined} action={data && data.overdue.count > 0 ? <TriangleAlert className="size-4 text-destructive" aria-hidden /> : undefined} {...common}>
        <TaskList tasks={data?.overdue.items ?? []} tz={tz} emptyTitle="No overdue tasks" emptyDescription="You are on schedule." />
      </AsyncCard>
      <AsyncCard title="Recently completed" description="Last 7 days" action={<CheckCircle2 className="size-4 text-success" aria-hidden />} {...common}>
        <TaskList tasks={data?.recentlyCompleted.items ?? []} tz={tz} showCompleted emptyTitle="Nothing completed yet" emptyDescription="Completed tasks appear here." />
      </AsyncCard>
    </div>
  );
}
export { ListChecks };