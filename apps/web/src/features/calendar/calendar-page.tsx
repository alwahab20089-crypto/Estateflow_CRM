import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/features/leads/use-leads';
import { PRIORITY_BORDER, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, TASK_TYPE_ICONS, isOpenStatus } from '@/features/tasks/task-constants';
import { useTaskActions } from '@/features/tasks/task-actions';
import { TaskDetailsDialog } from '@/features/tasks/task-details-dialog';
import { TaskFormDialog } from '@/features/tasks/task-form-dialog';
import { useCalendarTasks } from '@/features/tasks/use-tasks';
import { useTimezone } from '@/hooks/use-timezone';
import { addDays, addMonths, formatTimeTz, formatYmd, isValidYmd, startOfDayUtc, startOfMonth, startOfWeek, ymdInTz } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { TaskDto } from '@/types/tasks';

type View = 'month' | 'week' | 'day';
const VIEWS: View[] = ['month', 'week', 'day'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // weeks start on Monday
const opts = (list: string[]) => list.map((v) => ({ value: v, label: humanize(v) }));

function getRange(view: View, date: string) {
  if (view === 'month') { const start = startOfWeek(startOfMonth(date)); return { start, end: addDays(start, 42) }; } // always 6 full weeks
  if (view === 'week') { const start = startOfWeek(date); return { start, end: addDays(start, 7) }; }
  return { start: date, end: addDays(date, 1) };
}
function addMonthPreservingDay(date: string, amount: number) {
  const first = addMonths(date, amount);
  const lastDay = Number(addDays(addMonths(first, 1), -1).slice(8));
  const selectedDay = Math.min(Number(date.slice(8)), lastDay);

  return addDays(first, selectedDay - 1);
}

function EntryCard({ task, tz, onOpen }: { task: TaskDto; tz: string; onOpen: (id: string) => void }) {
  const Icon = TASK_TYPE_ICONS[task.taskType];
  return (
    <button type="button" onClick={() => onOpen(task._id)}
      className={cn('w-full space-y-1 rounded-md border border-l-4 bg-card p-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', PRIORITY_BORDER[task.priority], !isOpenStatus(task.status) && 'opacity-60')}>
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn('min-w-0 flex-1 font-medium', !isOpenStatus(task.status) && 'line-through')}>{task.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {task.dueAt && <time dateTime={task.dueAt}>{formatTimeTz(task.dueAt, tz)}</time>}
        <span>· {humanize(task.taskType)}</span>
        <span>· {task.assignee?.name ?? 'Unassigned'}</span>
      </span>
      <span className="flex gap-1"><StatusBadge status={task.status} /><StatusBadge status={task.priority} /></span>
    </button>
  );
}

export function CalendarPage() {
  const tz = useTimezone();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const actions = useTaskActions();
  const [createFor, setCreateFor] = useState<string | null>(null);

  const today = ymdInTz(new Date(), tz);
  const view = (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'month') as View;
  const rawDate = params.get('date');
  const date = isValidYmd(rawDate) ? rawDate : today;
  const pick = <T extends string>(k: string, list: readonly T[]) => (list as readonly string[]).includes(params.get(k) ?? '') ? (params.get(k) as T) : undefined;
  const status = pick('status', TASK_STATUSES);
  const priority = pick('priority', TASK_PRIORITIES);
  const taskType = pick('taskType', TASK_TYPES);
  const assignedToRaw = params.get('assignedTo');
  const assignedTo = assignedToRaw === 'me' || assignedToRaw === 'unassigned' || (assignedToRaw && /^[a-f\d]{24}$/i.test(assignedToRaw)) ? assignedToRaw : undefined;
  const detailId = params.get('task');

  const setParam = (patch: Record<string, string | undefined>) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);

      for (const [k, v] of Object.entries(patch)) {
        if (v) {
          n.set(k, v);
        } else {
          n.delete(k);
        }
      }

      return n;
    }, { replace: true });
  const seeAll = can('tasks:read_all') && can('members:read');
  const members = useMembers(seeAll);
  const range = useMemo(() => getRange(view, date), [view, date]);
  const query = useCalendarTasks({ from: startOfDayUtc(range.start, tz).toISOString(), to: startOfDayUtc(range.end, tz).toISOString(), status, priority, taskType, assignedTo });

  const byDay = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const t of query.data?.data ?? []) {
      if (!t.dueAt) continue;
      const key = ymdInTz(new Date(t.dueAt), tz);
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [query.data, tz]);

  const shift = (n: 1 | -1) =>
    setParam({
      date:
        view === 'month'
          ? addMonthPreservingDay(date, n)
          : addDays(date, view === 'week' ? 7 * n : n),
    });
  const title = view === 'month' ? formatYmd(date, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${formatYmd(range.start, { month: 'short', day: 'numeric' })} – ${formatYmd(addDays(range.end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`
      : formatYmd(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const selectedTasks = byDay.get(date) ?? [];
  const total = query.data?.data.length ?? 0;
  const open = (id: string) => setParam({ task: id });

  const days = Array.from({ length: view === 'month' ? 42 : view === 'week' ? 7 : 1 }, (_, i) => addDays(range.start, i));

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Task due dates and follow-ups. Times shown in ${tz}.`}
        actions={can('tasks:create') ? <Button onClick={() => setCreateFor(date)}><Plus /> Add task</Button> : undefined}
      />

      <Card className="gap-0 py-0">
        <div className="space-y-3 border-b p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setParam({ date: undefined })}>Today</Button>
            <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => shift(-1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Next period" onClick={() => shift(1)}><ChevronRight /></Button>
            <h2 className="text-section-title mx-1 flex-1" aria-live="polite">{title}</h2>
            <div role="group" aria-label="Calendar view" className="inline-flex rounded-md border p-0.5">
              {VIEWS.map((v) => (
                <Button key={v} size="sm" variant={view === v ? 'default' : 'ghost'} aria-pressed={view === v} onClick={() => setParam({ view: v === 'month' ? undefined : v })}>{humanize(v)}</Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
            <FilterSelect label="Status" allLabel="All statuses" value={status} onChange={(v) => setParam({ status: v })} options={opts(TASK_STATUSES)} />
            <FilterSelect label="Priority" allLabel="All priorities" value={priority} onChange={(v) => setParam({ priority: v })} options={opts(TASK_PRIORITIES)} />
            <FilterSelect label="Task type" allLabel="All types" value={taskType} onChange={(v) => setParam({ taskType: v })} options={opts(TASK_TYPES)} />
            <FilterSelect label="Assigned member" allLabel="Everyone" value={assignedTo} onChange={(v) => setParam({ assignedTo: v })}
              options={[{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }, ...(seeAll ? (members.data ?? []).map((m) => ({ value: m.userId, label: m.name })) : [])]} />
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {query.isError && !query.data ? (
            <ErrorState message={errorMessage(query.error, 'We could not load the calendar.')} onRetry={() => query.refetch()} />
          ) : query.isLoading ? (
            <div role="status" aria-label="Loading calendar" className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-72" /></div>
          ) : (
            <div aria-busy={query.isFetching} className={cn(query.isPlaceholderData && 'opacity-60 transition-opacity')}>
              {query.data?.meta.truncated && <p role="status" className="mb-2 text-sm text-warning">Showing the first 1,000 tasks. Use the filters to narrow this period.</p>}
              {total === 0 && <p className="mb-3 text-sm text-muted-foreground">No tasks are scheduled in this period.</p>}

              {view === 'month' && (
                <div role="grid" aria-label={title}>
                  <div role="row" className="grid grid-cols-7 border-b pb-1 text-center text-xs font-medium text-muted-foreground">
                    {WEEKDAYS.map((d) => <div key={d} role="columnheader">{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7">
                    {days.map((day) => {
                      const items = byDay.get(day) ?? [];
                      const inMonth = day.slice(0, 7) === date.slice(0, 7);
                      return (
                        <div key={day} role="gridcell" className={cn('min-h-14 border-b border-r p-1 sm:min-h-24', !inMonth && 'bg-muted/30 text-muted-foreground', day === date && 'bg-primary/5')}>
                          <button type="button" aria-label={formatYmd(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} aria-pressed={day === date} onClick={() => setParam({ date: day })}
                            className={cn('grid size-6 place-items-center rounded-full text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', day === today && 'bg-primary text-primary-foreground hover:bg-primary')}>
                            {Number(day.slice(8))}
                          </button>
                          {/* desktop: chips. mobile: a count (the day agenda below lists the tasks) */}
                          <ul className="mt-1 hidden space-y-0.5 md:block">
                            {items.slice(0, 3).map((t) => (
                              <li key={t._id}>
                                <button type="button" onClick={() => open(t._id)} className={cn('block w-full truncate rounded border-l-2 bg-card px-1 text-left text-xs hover:bg-accent', PRIORITY_BORDER[t.priority], !isOpenStatus(t.status) && 'line-through opacity-60')}>
                                  {t.dueAt && formatTimeTz(t.dueAt, tz)} {t.title}
                                </button>
                              </li>
                            ))}
                            {items.length > 3 && <li><button type="button" onClick={() => setParam({ date: day })} className="px-1 text-xs text-muted-foreground hover:underline">+{items.length - 3} more</button></li>}
                          </ul>
                          {items.length > 0 && <span className="mt-1 block text-center text-[10px] font-medium text-primary md:hidden" aria-label={`${items.length} tasks`}>● {items.length}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {view === 'week' && (
                <div className="grid gap-3 md:grid-cols-7">
                  {days.map((day) => (
                    <section key={day} aria-label={formatYmd(day, { weekday: 'long', month: 'long', day: 'numeric' })} className={cn('space-y-2 rounded-md border p-2', day === today && 'border-primary')}>
                      <h3 className="flex items-center justify-between text-sm font-medium">
                        <button type="button" onClick={() => setParam({ date: day, view: 'day' })} className="hover:underline">{formatYmd(day, { weekday: 'short', month: 'short', day: 'numeric' })}</button>
                        {can('tasks:create') && <button type="button" aria-label={`Add task on ${day}`} onClick={() => setCreateFor(day)} className="text-muted-foreground hover:text-foreground"><Plus className="size-4" /></button>}
                      </h3>
                      {(byDay.get(day) ?? []).map((t) => <EntryCard key={t._id} task={t} tz={tz} onOpen={open} />)}
                    </section>
                  ))}
                </div>
              )}

              {view === 'day' && (
                <ul className="space-y-2">
                  {selectedTasks.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled for this day.</li> : selectedTasks.map((t) => <li key={t._id}><EntryCard task={t} tz={tz} onOpen={open} /></li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        {view === 'month' && !query.isLoading && (
          <section aria-label="Selected day" className="space-y-2 border-t p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{formatYmd(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
              {can('tasks:create') && <Button size="sm" variant="outline" onClick={() => setCreateFor(date)}><Plus /> Add task on this day</Button>}
            </div>
            {selectedTasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks on this day.</p> : (
              <ul className="grid gap-2 md:grid-cols-2">{selectedTasks.map((t) => <li key={t._id}><EntryCard task={t} tz={tz} onOpen={open} /></li>)}</ul>
            )}
          </section>
        )}
      </Card>

      <TaskFormDialog open={createFor !== null} onOpenChange={(o) => !o && setCreateFor(null)} defaults={createFor ? { dueAt: `${createFor}T09:00` } : undefined} />
      <TaskDetailsDialog taskId={detailId} onClose={() => setParam({ task: undefined })} actions={actions} />
      {actions.dialogs}
    </>
  );
}