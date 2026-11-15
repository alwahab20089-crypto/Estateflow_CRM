import { resolveTimezone } from '@/lib/datetime';
import { useAuth } from '@/providers/auth-provider';

/** The organization's timezone (falls back to the browser's if it is missing or invalid). */
export function useTimezone() {
  const { activeMembership } = useAuth();
  return resolveTimezone(activeMembership?.organization.timezone);
}