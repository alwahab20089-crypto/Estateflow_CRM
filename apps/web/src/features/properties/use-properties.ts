// src/features/properties/use-properties.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { propertyService } from '@/services/property-service';
import type { PropertyListParams, PropertyPayload } from '@/types/properties';

const root = ['api', 'properties'] as const;
const DEALS_ROOT = ['api', 'deals'] as const; // property status and deal briefs depend on each other
export const propertyKeys = {
  all: root,
  list: (p: PropertyListParams) => [...root, 'list', p] as const,
  detail: (id: string) => [...root, 'detail', id] as const,
  activities: (id: string, limit: number) => [...root, 'activities', id, limit] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useProperties = (params: PropertyListParams, enabled = true) =>
  useQuery({ queryKey: propertyKeys.list(params), queryFn: ({ signal }) => propertyService.list(params, signal), placeholderData: keepPreviousData, enabled, retry });
export const useProperty = (id: string | undefined) =>
  useQuery({ queryKey: propertyKeys.detail(id ?? ''), queryFn: () => propertyService.get(id as string), enabled: Boolean(id), retry });
export const usePropertyActivities = (id: string, limit: number) =>
  useQuery({ queryKey: propertyKeys.activities(id, limit), queryFn: () => propertyService.activities(id, { limit }), placeholderData: keepPreviousData, retry });

function useInvalidating<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: root }), qc.invalidateQueries({ queryKey: DEALS_ROOT })]);
    },
  });
}

export const useCreateProperty = () => useInvalidating((p: PropertyPayload) => propertyService.create(p));
export const useUpdateProperty = () => useInvalidating((v: { id: string; payload: PropertyPayload }) => propertyService.update(v.id, v.payload));
export const useDeleteProperty = () => useInvalidating((id: string) => propertyService.archive(id));
export const useRestoreProperty = () => useInvalidating((id: string) => propertyService.restore(id));
export const useUpdatePropertyStatus = () => useInvalidating((v: { id: string; propertyStatus: string }) => propertyService.setStatus(v.id, v.propertyStatus));
export const useAssignProperty = () => useInvalidating((v: { id: string; assignedTo: string | null }) => propertyService.assign(v.id, v.assignedTo));
export const useUploadPropertyImages = () => useInvalidating((v: { id: string; files: File[] }) => propertyService.uploadImages(v.id, v.files));
export const useDeletePropertyImage = () => useInvalidating((v: { id: string; imageId: string }) => propertyService.deleteImage(v.id, v.imageId));