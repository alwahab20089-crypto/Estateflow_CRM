import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';

/** Errors that mean "the license changed under you". The UI then re-reads the license so buttons and banners catch up. */
const LICENSE_CODES = new Set(['LICENSE_LIMIT_REACHED', 'FEATURE_NOT_LICENSED']);
const isLicenseError = (err: unknown) => err instanceof ApiError && LICENSE_CODES.has(err.code);

const refreshLicense = () => void queryClient.invalidateQueries({ queryKey: ['api', 'license'] });

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (isLicenseError(err)) refreshLicense();
    },
  }),
  // Analytics and reports are derived from CRM records: any successful write makes them stale.
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api', 'analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['api', 'reports', 'run'] });
      // Writes change usage (a new lead is one more against the limit).
      refreshLicense();
    },
    onError: (err) => {
      // The screen shows the API's own message; this only refreshes the license state behind it.
      if (isLicenseError(err)) refreshLicense();
    },
  }),
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});