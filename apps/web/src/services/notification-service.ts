import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type { NotificationDto, NotificationListMeta, NotificationListParams } from '@/types/tasks';
import { toQuery } from './lead-service';

export const notificationService = {
  list: (p: NotificationListParams, signal?: AbortSignal) =>
    apiRequestPaged<NotificationDto[], NotificationListMeta>(`/notifications${toQuery({ ...p })}`, { signal }),
  unreadCount: (signal?: AbortSignal) => apiRequest<{ count: number }>('/notifications/unread-count', { signal }),
  markRead: (id: string) => apiRequest<NotificationDto>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest<{ updated: number }>('/notifications/read-all', { method: 'PATCH' }),
  remove: (id: string) => apiRequest<void>(`/notifications/${id}`, { method: 'DELETE' }),
};