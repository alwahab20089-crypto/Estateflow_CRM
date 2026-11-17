import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { automationService, notificationPreferenceService } from '@/services/automation-service';
import type { ExecutionListParams, PreferenceUpdate, WorkflowListParams, WorkflowPayload } from '@/types/automations';

const root = ['api', 'automations'] as const;
export const automationKeys = {
  all: root,
  list: (p: WorkflowListParams) => [...root, 'list', p] as const,
  detail: (id: string) => [...root, 'detail', id] as const,
  executions: (id: string, p: ExecutionListParams) => [...root, 'executions', id, p] as const,
  execution: (id: string, e: string) => [...root, 'execution', id, e] as const,
  preferences: ['api', 'notifications', 'preferences'] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useWorkflows = (p: WorkflowListParams) =>
  useQuery({ queryKey: automationKeys.list(p), queryFn: ({ signal }) => automationService.list(p, signal), placeholderData: keepPreviousData, retry });
export const useWorkflow = (id: string | undefined) =>
  useQuery({ queryKey: automationKeys.detail(id ?? ''), queryFn: ({ signal }) => automationService.get(id as string, signal), enabled: Boolean(id), retry });
export const useExecutions = (id: string, p: ExecutionListParams) =>
  useQuery({ queryKey: automationKeys.executions(id, p), queryFn: ({ signal }) => automationService.executions(id, p, signal), placeholderData: keepPreviousData, retry });
export const useExecution = (id: string, executionId: string | null) =>
  useQuery({ queryKey: automationKeys.execution(id, executionId ?? ''), queryFn: ({ signal }) => automationService.execution(id, executionId as string, signal), enabled: Boolean(executionId), retry });

function useInvalidating<V, D>(fn: (v: V) => Promise<D>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: root }) });
}
export const useCreateWorkflow = () => useInvalidating((p: WorkflowPayload) => automationService.create(p));
export const useUpdateWorkflow = () => useInvalidating((v: { id: string; payload: WorkflowPayload }) => automationService.update(v.id, v.payload));
export const useRemoveWorkflow = () => useInvalidating((id: string) => automationService.remove(id));
export const useActivateWorkflow = () => useInvalidating((id: string) => automationService.activate(id));
export const usePauseWorkflow = () => useInvalidating((id: string) => automationService.pause(id));
export const useRetryExecution = () => useInvalidating((v: { id: string; executionId: string }) => automationService.retry(v.id, v.executionId));
export const useTestWorkflow = () => useMutation({ mutationFn: (v: { id: string; entityId?: string }) => automationService.test(v.id, v.entityId ? { entityId: v.entityId } : { sample: {} }) });

export const usePreferences = () =>
  useQuery({ queryKey: automationKeys.preferences, queryFn: ({ signal }) => notificationPreferenceService.get(signal), retry });
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: PreferenceUpdate[]) => notificationPreferenceService.update(items),
    onSuccess: (data) => qc.setQueryData(automationKeys.preferences, data),
  });
}