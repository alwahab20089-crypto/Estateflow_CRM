import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type {
  ExecutionDto, ExecutionListParams, NotificationPreference, PagedMeta, PreferenceUpdate, TestResult,
  WorkflowDto, WorkflowListParams, WorkflowPayload,
} from '@/types/automations';
import { toQuery } from './lead-service';

const base = (id: string) => `/automations/${id}`;

export const automationService = {
  list: (p: WorkflowListParams, signal?: AbortSignal) =>
    apiRequestPaged<WorkflowDto[], PagedMeta>(`/automations${toQuery({ ...p })}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiRequest<WorkflowDto>(base(id), { signal }),
  create: (body: WorkflowPayload) => apiRequest<WorkflowDto>('/automations', { method: 'POST', body }),
  update: (id: string, body: Partial<WorkflowPayload>) => apiRequest<WorkflowDto>(base(id), { method: 'PATCH', body }),
  remove: (id: string) => apiRequest<void>(base(id), { method: 'DELETE' }),
  activate: (id: string) => apiRequest<WorkflowDto>(`${base(id)}/activate`, { method: 'POST' }),
  pause: (id: string) => apiRequest<WorkflowDto>(`${base(id)}/pause`, { method: 'POST' }),
  test: (id: string, body: { entityId?: string; sample?: Record<string, string | number | boolean | null> }) =>
    apiRequest<TestResult>(`${base(id)}/test`, { method: 'POST', body }),
  executions: (id: string, p: ExecutionListParams, signal?: AbortSignal) =>
    apiRequestPaged<ExecutionDto[], PagedMeta>(`${base(id)}/executions${toQuery({ ...p })}`, { signal }),
  execution: (id: string, executionId: string, signal?: AbortSignal) =>
    apiRequest<ExecutionDto>(`${base(id)}/executions/${executionId}`, { signal }),
  retry: (id: string, executionId: string) =>
    apiRequest<ExecutionDto>(`${base(id)}/executions/${executionId}/retry`, { method: 'POST' }),
};

export const notificationPreferenceService = {
  get: (signal?: AbortSignal) => apiRequest<NotificationPreference[]>('/notifications/preferences', { signal }),
  update: (preferences: PreferenceUpdate[]) =>
    apiRequest<NotificationPreference[]>('/notifications/preferences', { method: 'PATCH', body: { preferences } }),
};