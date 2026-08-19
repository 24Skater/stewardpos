import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registersApi, type RegisterOverrideQuery, type RequestOverrideRequest } from '@/lib/api';
import { queryKeys } from './keys';

/**
 * Manager overrides — a supervisor authorising exactly one privileged action
 * at a till without touching the cashier's shift. See
 * `backend/src/services/registerOverrides.ts` and `OverridePrompt.tsx`.
 */

/**
 * Mint a grant for one action on one register.
 *
 * Invalidates the override log on success: a grant that was requested — even
 * one a supervisor never goes on to spend — is a row in that log the moment
 * it exists, and `AdminOverrides.tsx` should not need a manual refresh to see
 * it appear.
 */
export function useRequestOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ registerId, body }: { registerId: string; body: RequestOverrideRequest }) =>
      registersApi.requestOverride(registerId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.overridesAll });
    },
  });
}

/** The override log — every grant ever issued in the org, spent or not, newest first. */
export function useRegisterOverrides(query?: RegisterOverrideQuery) {
  return useQuery({
    queryKey: queryKeys.registers.overrides(query),
    queryFn: () => registersApi.overrides(query),
  });
}
