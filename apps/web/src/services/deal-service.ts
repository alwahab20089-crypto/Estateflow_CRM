// src/services/deal-service.ts
import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type { CloseWonPayload, DealDto, DealListMeta, DealListParams, DealPayload, DealStage } from '@/types/deals';
import type { LeadActivityDto, PageMeta } from '@/types/leads';
import { toQuery } from './lead-service';

export const dealService = {
  list: (p: DealListParams, signal?: AbortSignal) =>
    apiRequestPaged<DealDto[], DealListMeta>(`/deals${toQuery(p as unknown as Record<string, string | number | undefined>)}`, { signal }),
  get: (id: string) => apiRequest<DealDto>(`/deals/${id}`),
  create: (body: DealPayload) => apiRequest<DealDto>('/deals', { method: 'POST', body }),
  update: (id: string, body: DealPayload) => apiRequest<DealDto>(`/deals/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiRequest<DealDto>(`/deals/${id}`, { method: 'DELETE' }),
  updateStage: (id: string, stage: DealStage) => apiRequest<DealDto>(`/deals/${id}/stage`, { method: 'PATCH', body: { stage } }),
  assign: (id: string, assignedTo: string | null) => apiRequest<DealDto>(`/deals/${id}/assign`, { method: 'PATCH', body: { assignedTo } }),
  closeWon: (id: string, body: CloseWonPayload) => apiRequest<DealDto>(`/deals/${id}/close-won`, { method: 'POST', body }),
  closeLost: (id: string, lostReason: string) => apiRequest<DealDto>(`/deals/${id}/close-lost`, { method: 'POST', body: { lostReason } }),
  reopen: (id: string, reason: string) => apiRequest<DealDto>(`/deals/${id}/reopen`, { method: 'POST', body: { reason } }),
  activities: (id: string, params: { limit: number }) =>
    apiRequestPaged<LeadActivityDto[], PageMeta>(`/deals/${id}/activities${toQuery({ ...params, page: 1 })}`),
};