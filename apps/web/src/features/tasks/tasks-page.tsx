import { ArrowDown, ArrowUp, ListChecks, MoreHorizontal, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTimezone } from '@/hooks/use-timezone';
import { formatDateTimeTz } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { TaskDto } from '@/types/tasks';
import { useTaskActions } from './task-actions';
import { isOpenStatus, PAGE_SIZES, RELATED_LABELS, relatedPath, TASK_TYPE_ICONS } from './task-constants';
import { TaskDetailsDialog } from './task-details-dialog';
import { TaskFiltersBar } from './task-filters-bar';
import { TaskFormDialog } from './task-form-dialog';
import { toTaskApiParams, useTaskFilters, type TaskFilters } from './use-task-filters';
import { useTasks } from './use-tasks';

function SortHead({ label, field, filters, onSort, className }: { label: string; field: TaskFilters['sortBy']; filters: TaskFilters; onSort: (f: TaskFilters['sortBy']) => void; className?: string }) {
  const active = filters.sortBy === field;
  return (
    <TableHead className={className} aria-sort={active ? (filters.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 font-medium hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {label}
        {active && (filters.sortOrder === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />)}
      </button>
    </TableHead>
  );
}

export function TasksPage() {
  const { can } = useAuth();
  const tz = useTimezone();
  const { filters, update, clear, hasActiveFilters } = useTaskFilters();
  const [params, setParams] = useSearchParams();
  const apiParams = useMemo(() => toTaskApiParams(filters, tz), [filters, tz]);
  const query = useTasks(apiParams);
  const actions = useTaskActions();
  const [createOpen, setCreateOpen] = useState(false);

  const tasks = query.data?.data ?? [];
  const meta = query.data?.meta;
  const archivedView = filters.view === 'archived';
  const detailId = params.get('task');
  const openDetails = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('task', id); return n; }, { replace: true });
  const closeDetails = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true });
  const onSort = (field: TaskFilters['sortBy']) =>
    update({ sortBy: field, sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : field === 'dueAt' || field === 'title' ? 'asc' : 'desc' });

  const showError = query.isError && !query.data;
  const showEmpty = !query.isLoading && !showError && tasks.length === 0;
  const addButton = can('tasks:create') ? <Button onClick={() => setCreateOpen(true)}><Plus /> Add task</Button> : undefined;

  return (
    <>
      <PageHeader
        title={archivedView ? 'Archived tasks' : 'Tasks'}
        description={query.isLoading ? 'Loading tasks…' : `${meta?.total ?? 0} ${meta?.total === 1 ? 'task' : 'tasks'}`}
        actions={
          <>
            {can('tasks:restore') && (
              <div className="mr-2 flex items-center gap-2">
                <Switch id="show-archived-tasks" checked={archivedView} onCheckedChange={(on) => update({ view: on ? 'archived' : undefined })} />
                <Label htmlFor="show-archived-tasks" className="font-normal">Show archived</Label>
              </div>
            )}
            {addButton}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <TaskFiltersBar filters={filters} hasActiveFilters={hasActiveFilters} onChange={update} onClear={clear} />

        {showError ? (
          <ErrorState message={errorMessage(query.error, 'We could not load your tasks.')} onRetry={() => query.refetch()} />
        ) : showEmpty ? (
          hasActiveFilters ? (
            <EmptyState icon={ListChecks} title="No tasks match your filters" description="Try a different search or clear the filters." action={<Button variant="outline" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={ListChecks} title={archivedView ? 'No archived tasks' : 'No tasks yet'} description={archivedView ? 'Archived tasks appear here and can be restored.' : 'Create a task to keep track of your next follow-up.'} action={!archivedView ? addButton : undefined} />
          )
        ) : (
          <div role={query.isLoading ? 'status' : undefined} aria-label={query.isLoading ? 'Loading tasks' : undefined} aria-busy={query.isFetching} className={cn('overflow-x-auto', query.isPlaceholderData && 'opacity-60 transition-opacity')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><span className="sr-only">Done</span></TableHead>
                  <SortHead label="Task" field="title" filters={filters} onSort={onSort} className="min-w-56" />
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <SortHead label="Due" field="dueAt" filters={filters} onSort={onSort} />
                  <SortHead label="Priority" field="priority" filters={filters} onSort={onSort} />
                  <TableHead className="hidden lg:table-cell">Assigned to</TableHead>
                  <SortHead label="Status" field="status" filters={filters} onSort={onSort} />
                  <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading
                  ? Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
                  : tasks.map((t) => <TaskRow key={t._id} task={t} tz={tz} archived={archivedView} actions={actions} onOpen={openDetails} />)}
              </TableBody>
            </Table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <Pagination page={meta.page} pageCount={meta.totalPages} total={meta.total} pageSize={meta.limit}
            onPageChange={(page) => update({ page: String(page) })} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(limit) => update({ limit: String(limit) })} />
        )}
      </Card>

      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TaskDetailsDialog taskId={archivedView ? null : detailId} onClose={closeDetails} actions={actions} />
      {actions.dialogs}
    </>
  );
}

function TaskRow({ task: t, tz, archived, actions, onOpen }: { task: TaskDto; tz: string; archived: boolean; actions: ReturnType<typeof useTaskActions>; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const Icon = TASK_TYPE_ICONS[t.taskType];
  const open = isOpenStatus(t.status);
  const canUpdate = can('tasks:update');
  return (
    <TableRow className={cn(!open && 'text-muted-foreground')}>
      <TableCell>
        {canUpdate && !archived && (
          <Checkbox checked={!open} aria-label={open ? `Complete ${t.title}` : `Reopen ${t.title}`}
            onCheckedChange={() => void (open ? actions.complete(t) : actions.reopen(t))} />
        )}
      </TableCell>
      <TableCell className="min-w-56">
        {archived ? <span className="font-medium">{t.title}</span> : (
          <button type="button" onClick={() => onOpen(t._id)} className={cn('text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', !open && 'line-through')}>{t.title}</button>
        )}
        {t.related && (
          <p className="text-caption">
            {RELATED_LABELS[t.related.type]}:{' '}
            <Link to={relatedPath(t.related.type, t.related._id)} className="hover:underline">{t.related.label}</Link>
          </p>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell"><span className="inline-flex items-center gap-1.5"><Icon className="size-4" aria-hidden />{humanize(t.taskType)}</span></TableCell>
      <TableCell className="whitespace-nowrap">
        {t.dueAt ? (
          <time dateTime={t.dueAt} className={cn(t.isOverdue && 'font-medium text-destructive')}>
            {formatDateTimeTz(t.dueAt, tz)}{t.isOverdue && <span className="ml-1 text-xs">(overdue)</span>}
          </time>
        ) : '—'}
      </TableCell>
      <TableCell><StatusBadge status={t.priority} /></TableCell>
      <TableCell className="hidden lg:table-cell">{t.assignee?.name ?? 'Unassigned'}</TableCell>
      <TableCell><StatusBadge status={t.status} /></TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${t.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {archived ? (
              can('tasks:restore') && <DropdownMenuItem onSelect={() => void actions.restore(t)}>Restore</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => onOpen(t._id)}>View details</DropdownMenuItem>
                {canUpdate && open && <DropdownMenuItem onSelect={() => actions.edit(t)}>Edit</DropdownMenuItem>}
                {canUpdate && open && <DropdownMenuItem onSelect={() => void actions.complete(t)}>Mark complete</DropdownMenuItem>}
                {canUpdate && !open && <DropdownMenuItem onSelect={() => void actions.reopen(t)}>Reopen</DropdownMenuItem>}
                {can('tasks:assign') && <DropdownMenuItem onSelect={() => actions.assign(t)}>Reassign</DropdownMenuItem>}
                {(canUpdate && open) || can('tasks:delete') ? <DropdownMenuSeparator /> : null}
                {canUpdate && open && <DropdownMenuItem onSelect={() => actions.cancel(t)}>Cancel task</DropdownMenuItem>}
                {can('tasks:delete') && <DropdownMenuItem className="text-destructive" onSelect={() => actions.archive(t)}>Archive</DropdownMenuItem>}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}