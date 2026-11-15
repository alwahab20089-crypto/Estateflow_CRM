import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { notificationService } from '@/services/notification-service';
import type { NotificationListParams, NotificationListResult } from '@/types/tasks';

const root = ['api', 'notifications'] as const;
export const notificationKeys = {
  all: root,
  list: (p: NotificationListParams) => [...root, 'list', p] as const,
  count: [...root, 'unread-count'] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useNotifications = (params: NotificationListParams, enabled = true) =>
  useQuery({ queryKey: notificationKeys.list(params), queryFn: ({ signal }) => notificationService.list(params, signal), placeholderData: keepPreviousData, enabled, retry });

/** Polls once a minute, only while the tab is visible. This is what makes new reminders show up without a reload. */
export const useUnreadNotificationCount = (enabled = true) =>
  useQuery({
    queryKey: notificationKeys.count,
    queryFn: ({ signal }) => notificationService.unreadCount(signal).then((r) => r.count),
    enabled, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, staleTime: 30_000, retry,
  });

type Snapshot = { lists: Array<[readonly unknown[], NotificationListResult | undefined]>; count: number | undefined };
const listsKey = [...root, 'list'] as const;

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onMutate: async (id): Promise<Snapshot> => {
      await qc.cancelQueries({ queryKey: root });
      const lists = qc.getQueriesData<NotificationListResult>({ queryKey: listsKey });
      const count = qc.getQueryData<number>(notificationKeys.count);
      const wasUnread = lists.some(([, d]) => d?.data.some((n) => n._id === id && !n.isRead));
      qc.setQueriesData<NotificationListResult>({ queryKey: listsKey }, (old) =>
        old ? { ...old, data: old.data.map((n) => (n._id === id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n)), meta: { ...old.meta, unreadCount: Math.max(0, old.meta.unreadCount - (wasUnread ? 1 : 0)) } } : old);
      if (wasUnread && count !== undefined) qc.setQueryData(notificationKeys.count, Math.max(0, count - 1));
      return { lists, count };
    },
    onError: (_e, _id, snap) => {
      snap?.lists.forEach(([k, d]) => qc.setQueryData(k, d));
      if (snap?.count !== undefined) qc.setQueryData(notificationKeys.count, snap.count);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: root }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => notificationService.markAllRead(), onSuccess: () => qc.invalidateQueries({ queryKey: root }) });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => notificationService.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: root }) });
}