import { MutationCache, QueryClient } from '@tanstack/react-query';

export const queryClient: QueryClient = new QueryClient({
  // Analytics and reports are derived from CRM records: any successful write makes them stale.
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api', 'analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['api', 'reports', 'run'] });
    },
  }),
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});