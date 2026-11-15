import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { taskService } from '@/services/task-service';
import type { CalendarParams, CalendarResult, TaskDto, TaskListParams, TaskListResult, TaskPayload, TaskState, TaskSummaryParams } from '@/types/tasks';

const root = ['api', 'tasks'] as const;
export const taskKeys = {
  all: root,
  list: (p: TaskListParams) => [...root, 'list', p] as const,
  detail: (id: string) => [...root, 'detail', id] as const,
  calendar: (p: CalendarParams) => [...root, 'calendar', p] as const,
  summary: (p: TaskSummaryParams) => [...root, 'summary', p] as const,
  activities: (id: string, limit: number) => [...root, 'activities', id, limit] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useTasks = (params: TaskListParams, enabled = true) =>
  useQuery({ queryKey: taskKeys.list(params), queryFn: ({ signal }) => taskService.list(params, signal), placeholderData: keepPreviousData, enabled, retry });

export const useTask = (id: string | undefined) =>
  useQuery({ queryKey: taskKeys.detail(id ?? ''), queryFn: () => taskService.get(id as string), enabled: Boolean(id), retry });

export const useCalendarTasks = (params: CalendarParams, enabled = true) =>
  useQuery({ queryKey: taskKeys.calendar(params), queryFn: ({ signal }) => taskService.calendar(params, signal), placeholderData: keepPreviousData, enabled, retry });

/** One request feeds every dashboard widget (same key = shared by all of them). */
export const useTaskSummary = (params: TaskSummaryParams, enabled = true) =>
  useQuery({ queryKey: taskKeys.summary(params), queryFn: ({ signal }) => taskService.summary(params, signal), enabled, staleTime: 30_000, retry });

export const useTaskActivities = (id: string, limit: number, enabled = true) =>
  useQuery({ queryKey: taskKeys.activities(id, limit), queryFn: () => taskService.activities(id, { limit }), enabled: enabled && Boolean(id), retry });

/** Task events also add timeline entries to the linked lead/contact/property/deal. */
const RELATED_ROOTS = ['leads', 'contacts', 'properties', 'deals'];
const invalidateAll = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: root }),
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'api' && RELATED_ROOTS.includes(String(q.queryKey[1])) && q.queryKey.includes('activities') }),
  ]);

function useInvalidating<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateAll(qc) });
}

export const useCreateTask = () => useInvalidating((p: TaskPayload) => taskService.create(p));
export const useUpdateTask = () => useInvalidating((v: { id: string; payload: TaskPayload }) => taskService.update(v.id, v.payload));
export const useDeleteTask = () => useInvalidating((id: string) => taskService.remove(id));
export const useRestoreTask = () => useInvalidating((id: string) => taskService.restore(id));
export const useAssignTask = () => useInvalidating((v: { id: string; assignedTo: string | null }) => taskService.assign(v.id, v.assignedTo));

/* ---- optimistic status changes: the row updates at once; any failure puts every cache back ---- */
type Lists = { data: TaskDto[] };
function applyOptimistic(qc: QueryClient, id: string, patch: Partial<TaskDto>) {
  const apply = (old?: Lists) => (old ? { ...old, data: old.data.map((t) => (t._id === id ? { ...t, ...patch } : t)) } : old);
  const keys = [[...root, 'list'], [...root, 'calendar']] as const;
  const snapshots = keys.flatMap((k) => qc.getQueriesData<Lists>({ queryKey: k }));
  keys.forEach((k) => qc.setQueriesData<Lists>({ queryKey: k }, apply));
  const detail = qc.getQueryData<TaskDto>(taskKeys.detail(id));
  if (detail) qc.setQueryData(taskKeys.detail(id), { ...detail, ...patch });
  return { snapshots, detail, id };
}
type Snap = ReturnType<typeof applyOptimistic>;
function rollback(qc: QueryClient, snap?: Snap) {
  if (!snap) return;
  snap.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
  if (snap.detail) qc.setQueryData(taskKeys.detail(snap.id), snap.detail);
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: TaskState; note?: string }) => taskService.updateStatus(v.id, v.status, v.note),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: root });
      const closed = v.status === 'COMPLETED' || v.status === 'CANCELLED';
      return applyOptimistic(qc, v.id, { status: v.status, completedAt: v.status === 'COMPLETED' ? new Date().toISOString() : null, ...(closed ? { isOverdue: false } : {}) });
    },
    onError: (_e, _v, snap) => rollback(qc, snap),
    onSettled: () => invalidateAll(qc),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; note?: string }) => taskService.complete(v.id, v.note),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: root });
      return applyOptimistic(qc, v.id, { status: 'COMPLETED', completedAt: new Date().toISOString(), isOverdue: false });
    },
    onError: (_e, _v, snap) => rollback(qc, snap),
    onSettled: () => invalidateAll(qc),
  });
}
export type { CalendarResult, TaskListResult };