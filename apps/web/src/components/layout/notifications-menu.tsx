import { Bell, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadNotificationCount } from '@/features/notifications/use-notifications';
import { relatedPath, taskPath } from '@/features/tasks/task-constants';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { NotificationDto } from '@/types/tasks';

const targetOf = (n: NotificationDto) =>
  n.taskId ? taskPath(n.taskId) : n.relatedEntityType && n.relatedEntityId ? relatedPath(n.relatedEntityType, n.relatedEntityId) : null;

export function NotificationsMenu() {
  const { can } = useAuth();
  const canRead = can('notifications:read');
  const canManage = can('notifications:manage');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const count = useUnreadNotificationCount(canRead);
  const list = useNotifications({ page: 1, limit: 20, unread: unreadOnly ? 'true' : undefined }, canRead && open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();
  if (!canRead) return null;

  const unread = count.data ?? 0;
  const items = list.data?.data ?? [];

  const openItem = (n: NotificationDto) => {
    if (!n.isRead && canManage) markRead.mutate(n._id, { onError: (e) => toast.error(errorMessage(e, 'Could not mark as read')) });
    const target = targetOf(n);
    if (target) { setOpen(false); navigate(target); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications, ${unread} unread`}>
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span data-testid="unread-badge" className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground ring-2 ring-card">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {canManage && (
            <Button variant="ghost" size="sm" disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate(undefined, { onError: (e) => toast.error(errorMessage(e, 'Could not mark all as read')) })}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Switch id="notif-unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          <Label htmlFor="notif-unread-only" className="text-xs font-normal">Unread only</Label>
        </div>

        {list.isLoading ? (
          <div role="status" aria-label="Loading notifications" className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : list.isError && !list.data ? (
          <ErrorState message="We could not load your notifications." onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title={unreadOnly ? 'No unread notifications' : "You're all caught up"} description="New notifications will appear here." />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n._id} className={cn('flex items-start gap-1 px-2 py-1', !n.isRead && 'bg-primary/5')}>
                <button type="button" onClick={() => openItem(n)} className="min-w-0 flex-1 rounded px-2 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <span className="flex items-center gap-2">
                    {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <span className="text-sm font-medium">{n.title}</span>
                  </span>
                  <span className="block text-sm text-muted-foreground">{n.message}</span>
                  <span className="text-caption mt-1 block">{formatRelative(n.createdAt)}</span>
                </button>
                {canManage && (
                  <Button variant="ghost" size="icon" className="mt-1 size-7" aria-label={`Delete notification: ${n.title}`}
                    onClick={() => remove.mutate(n._id, { onError: (e) => toast.error(errorMessage(e, 'Could not delete the notification')) })}>
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}