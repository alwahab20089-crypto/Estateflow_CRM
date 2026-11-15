import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTimezone } from '@/hooks/use-timezone';
import { formatDateTimeTz } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { TaskRelatedType } from '@/types/tasks';
import { isOpenStatus, taskPath } from './task-constants';
import { TaskFormDialog } from './task-form-dialog';
import { useTasks } from './use-tasks';

/** Tasks linked to a lead/contact/property/deal. "Add task" opens the form with this record already selected. */
export function RelatedTasksCard({ entityType, entityId, entityLabel }: { entityType: TaskRelatedType; entityId: string; entityLabel: string }) {
  const { can } = useAuth();
  const tz = useTimezone();
  const allowed = can('tasks:read');
  const query = useTasks({ page: 1, limit: 10, relatedEntityType: entityType, relatedEntityId: entityId, sortBy: 'dueAt', sortOrder: 'asc', view: 'active' }, allowed);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  const tasks = query.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-section-title">Tasks</CardTitle>
        {can('tasks:create') && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> Add task</Button>}
      </CardHeader>
      <CardContent>
        {query.isLoading ? <Skeleton className="h-12" /> : query.isError ? <p role="alert" className="text-sm text-destructive">Could not load tasks.</p> : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t._id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <Link to={taskPath(t._id)} className={cn('block truncate hover:underline', !isOpenStatus(t.status) && 'text-muted-foreground line-through')}>{t.title}</Link>
                  {t.dueAt && <span className={cn('text-caption', t.isOverdue && 'text-destructive')}>{formatDateTimeTz(t.dueAt, tz)}</span>}
                </span>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <TaskFormDialog open={open} onOpenChange={setOpen} defaults={{ related: { type: entityType, id: entityId, label: entityLabel } }} />
    </Card>
  );
}