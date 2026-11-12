// src/services/property-service.ts
import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type { LeadActivityDto, PageMeta } from '@/types/leads';
import type { PropertyDetailDto, PropertyDto, PropertyListMeta, PropertyListParams, PropertyPayload } from '@/types/properties';
import { endOfDay, startOfDay, toQuery } from './lead-service';

const API_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').origin; } catch { return ''; }
})();
/** Local-storage images come back as relative /uploads/... paths; cloud providers return absolute URLs. */
export const assetUrl = (url: string | null) => (!url ? null : /^https?:\/\//.test(url) ? url : `${API_ORIGIN}${url}`);

export const propertyService = {
  list: (p: PropertyListParams, signal?: AbortSignal) =>
    apiRequestPaged<PropertyDto[], PropertyListMeta>(
      `/properties${toQuery({
        ...p,
        includeClosed: p.includeClosed ? 'true' : undefined,
        createdFrom: p.createdFrom ? startOfDay(p.createdFrom) : undefined,
        createdTo: p.createdTo ? endOfDay(p.createdTo) : undefined,
      } as Record<string, string | number | undefined>)}`,
      { signal },
    ),
  get: (id: string) => apiRequest<PropertyDetailDto>(`/properties/${id}`),
  create: (body: PropertyPayload) => apiRequest<PropertyDto>('/properties', { method: 'POST', body }),
  update: (id: string, body: PropertyPayload) => apiRequest<PropertyDto>(`/properties/${id}`, { method: 'PATCH', body }),
  archive: (id: string) => apiRequest<PropertyDto>(`/properties/${id}`, { method: 'DELETE' }),
  restore: (id: string) => apiRequest<PropertyDto>(`/properties/${id}/restore`, { method: 'POST' }),
  setStatus: (id: string, propertyStatus: string) => apiRequest<PropertyDto>(`/properties/${id}/status`, { method: 'PATCH', body: { propertyStatus } }),
  assign: (id: string, assignedTo: string | null) => apiRequest<PropertyDto>(`/properties/${id}/assign`, { method: 'PATCH', body: { assignedTo } }),
  uploadImages: (id: string, files: File[]) => {
    const body = new FormData();
    files.forEach((f) => body.append('images', f));
    return apiRequest<PropertyDto>(`/properties/${id}/images`, { method: 'POST', body });
  },
  deleteImage: (id: string, imageId: string) => apiRequest<PropertyDto>(`/properties/${id}/images/${imageId}`, { method: 'DELETE' }),
  activities: (id: string, params: { limit: number }) =>
    apiRequestPaged<LeadActivityDto[], PageMeta>(`/properties/${id}/activities${toQuery({ ...params, page: 1 })}`),
};