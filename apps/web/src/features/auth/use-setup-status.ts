import { useQuery } from '@tanstack/react-query';
import { authService } from '@/services/auth-service';

/**
 * Is this a brand-new install that still needs its owner account? Registration is first-run only, so the login and
 * register pages use this to send people to the right place. If the call fails the pages behave as before and the
 * server (which answers REGISTRATION_CLOSED) stays the authority.
 */
export const useSetupStatus = () =>
  useQuery({
    queryKey: ['api', 'auth', 'setup'],
    queryFn: ({ signal }) => authService.setupStatus(signal),
    staleTime: 30_000,
    retry: false,
  });