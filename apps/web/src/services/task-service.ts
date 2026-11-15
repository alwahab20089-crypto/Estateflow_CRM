import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type { LeadActivityDto, PageMeta } from '@/types/leads';
import type {
  CalendarMeta, CalendarParams, TaskDto, TaskListParams, TaskPayload, TaskState, TaskSummaryDto, TaskSummaryParams,
} from '@/types/tasks';
import { toQuery } from './lead-service';

const q = (p: object) => toQuery(p as Record<string, string | number | undefined>);

export const taskService = {
  list: (p: TaskListParams, signal?: AbortSignal) => apiRequestPaged<TaskDto[], PageMeta>(`/tasks${q(p)}`, { signal }),
  calendar: (p: CalendarParams, signal?: AbortSignal) => apiRequestPaged<TaskDto[], CalendarMeta>(`/tasks/calendar${q(p)}`, { signal }),
  summary: (p: TaskSummaryParams, signal?: AbortSignal) => apiRequest<TaskSummaryDto>(`/tasks/summary${q(p)}`, { signal }),
  get: (id: string) => apiRequest<TaskDto>(`/tasks/${id}`),
  create: (body: TaskPayload) => apiRequest<TaskDto>('/tasks', { method: 'POST', body }),
  update: (id: string, body: TaskPayload) => apiRequest<TaskDto>(`/tasks/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiRequest<TaskDto>(`/tasks/${id}`, { method: 'DELETE' }),
  restore: (id: string) => apiRequest<TaskDto>(`/tasks/${id}/restore`, { method: 'PATCH' }),
  updateStatus: (id: string, status: TaskState, note?: string) =>
    apiRequest<TaskDto>(`/tasks/${id}/status`, { method: 'PATCH', body: { status, ...(note ? { note } : {}) } }),
  complete: (id: string, note?: string) =>
    apiRequest<TaskDto>(`/tasks/${id}/complete`, { method: 'PATCH', body: note ? { note } : {} }),
  assign: (id: string, assignedTo: string | null) =>
    apiRequest<TaskDto>(`/tasks/${id}/assign`, { method: 'PATCH', body: { assignedTo } }),
  activities: (id: string, params: { limit: number }) =>
    apiRequestPaged<LeadActivityDto[], PageMeta>(`/tasks/${id}/activities${q({ ...params, page: 1 })}`),
};