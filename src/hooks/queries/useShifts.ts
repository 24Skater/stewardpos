import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registersApi, type RegisterShiftQuery } from '@/lib/api';
import { queryKeys } from './keys';

/**
 * Register shifts — which cashier (if any) is currently signed on to a till.
 *
 * `useCurrentShift` is the source of truth `LockScreen`/`POS.tsx` read to
 * decide whether the till is locked; `useStartShift`/`useEndShift` are the
 * only ways that answer changes, so both invalidate it on success rather than
 * leaving the lock screen to find out on its next poll.
 */

export function useCurrentShift(registerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.registers.currentShift(registerId ?? ''),
    queryFn: () => registersApi.currentShift(registerId as string),
    enabled: Boolean(registerId) && enabled,
    // A shift can end server-side between polls (idle expiry is lazy — see
    // `services/registerShifts.ts`'s `getOpenShift`), so this is re-checked
    // periodically rather than trusted indefinitely once fetched.
    staleTime: 15_000,
  });
}

export function useStartShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ registerId, pin }: { registerId: string; pin: string }) =>
      registersApi.startShift(registerId, pin),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.currentShift(variables.registerId) });
    },
  });
}

export function useEndShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (registerId: string) => registersApi.endShift(registerId),
    onSuccess: (_data, registerId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.currentShift(registerId) });
    },
  });
}

/**
 * The shift log — every shift ever opened in the org, newest first.
 *
 * Distinct from `useCurrentShift` above in both question and audience: that
 * one asks a single till "is anybody signed on right now" and drives the lock
 * screen, so it re-checks on a timer. This one asks the back office "who was
 * on the tills, and when", which is a record of the past and does not change
 * under the reader — so it is left to the default staleness rather than
 * polling a history table.
 */
export function useRegisterShiftLog(query?: RegisterShiftQuery) {
  return useQuery({
    queryKey: queryKeys.registers.shiftLog(query),
    queryFn: () => registersApi.shifts(query),
  });
}
