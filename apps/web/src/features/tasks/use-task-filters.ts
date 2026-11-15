import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { endOfDayUtc, isValidYmd, startOfDayUtc } from '@/lib/datetime';
import type { TaskKind, TaskListParams, TaskPriorityValue, TaskState } from '@/types/tasks';
import { PAGE_SIZES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from './task-constants';

export interface TaskFilters {
  page: number; limit: number; search?: string; status?: TaskState; priority?: TaskPriorityValue; taskType?: TaskKind;
  assignedTo?: string; dueFrom?: string; dueTo?: string; // yyyy-mm-dd in the organization's timezone
  overdue: boolean; sortBy: TaskListParams['sortBy']; sortOrder: 'asc' | 'desc'; view: 'active' | 'archived';
}
const FILTER_KEYS = ['page', 'limit', 'search', 'status', 'priority', 'taskType', 'assignedTo', 'dueFrom', 'dueTo', 'overdue', 'sortBy', 'sortOrder', 'view'];
const SORTS: TaskFilters['sortBy'][] = ['createdAt', 'dueAt', 'priority', 'status', 'title'];
const oneOf = <T extends string>(v: string | null, list: readonly T[]) => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);

export function useTaskFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<TaskFilters>(() => {
    const assignedTo = params.get('assignedTo');
    const limit = Number(params.get('limit'));
    const dueFrom = params.get('dueFrom');
    const dueTo = params.get('dueTo');
    return {
      page: Math.max(1, Number(params.get('page')) || 1),
      limit: PAGE_SIZES.includes(limit) ? limit : 20,
      search: params.get('search')?.trim() || undefined,
      status: oneOf(params.get('status'), TASK_STATUSES),
      priority: oneOf(params.get('priority'), TASK_PRIORITIES),
      taskType: oneOf(params.get('taskType'), TASK_TYPES),
      assignedTo: assignedTo === 'me' || assignedTo === 'unassigned' || (assignedTo && /^[a-f\d]{24}$/i.test(assignedTo)) ? assignedTo : undefined,
      dueFrom: isValidYmd(dueFrom) ? dueFrom : undefined,
      dueTo: isValidYmd(dueTo) ? dueTo : undefined,
      overdue: params.get('overdue') === 'true',
      sortBy: oneOf(params.get('sortBy'), SORTS) ?? 'dueAt',
      sortOrder: params.get('sortOrder') === 'desc' ? 'desc' : params.get('sortOrder') === 'asc' ? 'asc' : (params.get('sortBy') && params.get('sortBy') !== 'dueAt' ? 'desc' : 'asc'),
      view: params.get('view') === 'archived' ? 'archived' : 'active',
    };
  }, [params]);

  /** Any filter change returns to page 1; other params (e.g. ?task=) are preserved. */
  const update = useCallback((patch: Record<string, string | undefined>) => {
  setParams((prev) => {
    const next = new URLSearchParams(prev);

    for (const [k, v] of Object.entries(patch)) {
      if (v) {
        next.set(k, v);
      } else {
        next.delete(k);
      }
    }

    if (!('page' in patch)) {
      next.delete('page');
    }

    return next;
  }, { replace: true });
}, [setParams]);

  const clear = useCallback(() => setParams((prev) => {
    const next = new URLSearchParams(prev);
    FILTER_KEYS.filter((k) => k !== 'view').forEach((k) => next.delete(k));
    return next;
  }, { replace: true }), [setParams]);

  const hasActiveFilters = Boolean(filters.search || filters.status || filters.priority || filters.taskType || filters.assignedTo || filters.dueFrom || filters.dueTo || filters.overdue);
  return { filters, update, clear, hasActiveFilters };
}

export function toTaskApiParams(f: TaskFilters, tz: string): TaskListParams {
  return {
    page: f.page, limit: f.limit, search: f.search, status: f.status, priority: f.priority, taskType: f.taskType, assignedTo: f.assignedTo,
    dueFrom: f.dueFrom ? startOfDayUtc(f.dueFrom, tz).toISOString() : undefined,
    dueTo: f.dueTo ? endOfDayUtc(f.dueTo, tz).toISOString() : undefined,
    overdue: f.overdue ? 'true' : undefined, sortBy: f.sortBy, sortOrder: f.sortOrder, view: f.view,
  };
}