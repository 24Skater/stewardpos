import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clearSessionCache, getCurrentSession, type AuthSession } from '@/lib/auth';

const SESSION_KEY = ['session'] as const;

/**
 * The signed-in user and their merged permissions.
 *
 * Resolves to `null` rather than erroring when there is no valid token — "signed
 * out" is an answer, not a failure, and the guards need to distinguish it from
 * "still checking". Retries are off for the same reason.
 */
export function useSession() {
  return useQuery<AuthSession | null>({
    queryKey: SESSION_KEY,
    queryFn: () => getCurrentSession(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Drop the cached session — call after login or logout so guards re-evaluate.
 *
 * Both caches, in that order. `auth.ts` keeps its own module-level copy and
 * returns it without asking the server; clearing only the query cache re-ran
 * the query and got the stale object straight back, so an invalidation looked
 * like it worked and changed nothing.
 */
export function useInvalidateSession() {
  const queryClient = useQueryClient();
  return () => {
    clearSessionCache();
    return queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  };
}
