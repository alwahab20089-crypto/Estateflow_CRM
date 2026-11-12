// src/features/deals/use-deals.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { dealService } from '@/services/deal-service';
import type { CloseWonPayload, DealListParams, DealListResult, DealPayload, DealStage } from '@/types/deals';

const root = ['api', 'deals'] as const;
const PROPERTIES_ROOT = ['api', 'properties'] as const; // closing a deal changes the property's status
export const dealKeys = {
  all: root,
  list: (p: DealListParams) => [...root, 'list', p] as const,
  detail: (id: string) => [...root, 'detail', id] as const,
  activities: (id: string, limit: number) => [...root, 'activities', id, limit] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useDeals = (params: DealListParams, enabled = true) =>
  useQuery({ queryKey: dealKeys.list(params), queryFn: ({ signal }) => dealService.list(params, signal), placeholderData: keepPreviousData, enabled, retry });
export const useDeal = (id: string | undefined) =>
  useQuery({ queryKey: dealKeys.detail(id ?? ''), queryFn: () => dealService.get(id as string), enabled: Boolean(id), retry });
export const useDealActivities = (id: string, limit: number) =>
  useQuery({ queryKey: dealKeys.activities(id, limit), queryFn: () => dealService.activities(id, { limit }), placeholderData: keepPreviousData, retry });

function useInvalidating<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: root }), qc.invalidateQueries({ queryKey: PROPERTIES_ROOT })]);
    },
  });
}

export const useCreateDeal = () => useInvalidating((p: DealPayload) => dealService.create(p));
export const useUpdateDeal = () => useInvalidating((v: { id: string; payload: DealPayload }) => dealService.update(v.id, v.payload));
export const useDeleteDeal = () => useInvalidating((id: string) => dealService.remove(id));
export const useAssignDeal = () => useInvalidating((v: { id: string; assignedTo: string | null }) => dealService.assign(v.id, v.assignedTo));
export const useCloseDealWon = () => useInvalidating((v: { id: string; payload: CloseWonPayload }) => dealService.closeWon(v.id, v.payload));
export const useCloseDealLost = () => useInvalidating((v: { id: string; lostReason: string }) => dealService.closeLost(v.id, v.lostReason));
export const useReopenDeal = () => useInvalidating((v: { id: string; reason: string }) => dealService.reopen(v.id, v.reason));

/** Optimistic: the card moves at once; the server decides, and any failure puts it back. */
export function useUpdateDealStage() {
  const qc = useQueryClient();
  const listKey = [...root, 'list'] as const;
  return useMutation({
    mutationFn: (v: { id: string; stage: DealStage }) => dealService.updateStage(v.id, v.stage),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: root });
      const snapshots = qc.getQueriesData<DealListResult>({ queryKey: listKey });
      qc.setQueriesData<DealListResult>({ queryKey: listKey }, (old) =>
        old ? { ...old, data: old.data.map((d) => (d._id === v.id ? { ...d, stage: v.stage } : d)) } : old,
      );
      return { snapshots };
    },
    onError: (_err, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: root }), qc.invalidateQueries({ queryKey: PROPERTIES_ROOT })]);
    },
  });
}