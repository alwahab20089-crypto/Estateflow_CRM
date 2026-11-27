import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { licenseService } from '@/services/license-service';
import type { FeatureKey, LimitKey } from '@/types/license';
import { createBlockReason, featureBlockReason } from './license-utils';

export const licenseKeys = {
  all: ['api', 'license'] as const,
  status: ['api', 'license', 'status'] as const,
  current: ['api', 'license', 'current'] as const,
};

const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

/** Readable by every member. Refetched when the window regains focus, so an expiry is noticed without a reload. */
export const useLicenseStatus = () =>
  useQuery({
    queryKey: licenseKeys.status,
    queryFn: ({ signal }) => licenseService.status(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry,
  });

/** Owner only (license:read). */
export const useLicenseOverview = (enabled = true) =>
  useQuery({
    queryKey: licenseKeys.current,
    queryFn: ({ signal }) => licenseService.current(signal),
    enabled,
    staleTime: 30_000,
    retry,
  });

function useLicenseMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Activating or deactivating changes what every screen may do.
    onSuccess: () => qc.invalidateQueries({ queryKey: licenseKeys.all }),
  });
}

export const useActivateLicense = () => useLicenseMutation((key: string) => licenseService.activate(key));
export const useDeactivateLicense = () => useLicenseMutation(() => licenseService.deactivate());

/**
 * Is a licensed feature available? While the status is loading `allowed` is false and `loading` is true, so
 * callers do not fire requests that would be rejected. If the status cannot be loaded at all, the feature is
 * treated as allowed and the server stays the authority.
 */
export function useFeature(feature: FeatureKey) {
  const q = useLicenseStatus();
  const reason = featureBlockReason(q.data, feature);
  const loading = q.isLoading;
  return { loading, allowed: !loading && reason === null, reason: reason ?? undefined };
}

/** Whether "Add" actions for a counted resource are blocked by the license. Unknown status never blocks. */
export function useCreateGuard(key: LimitKey) {
  const q = useLicenseStatus();
  const reason = createBlockReason(q.data, key);
  return { blocked: reason !== null, reason: reason ?? undefined };
}