import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  registersApi,
  locationsApi,
  type CreateLocationRequest,
  type CreateRegisterRequest,
  type RegisterListQuery,
  type UpdateLocationRequest,
  type UpdateRegisterRequest,
} from '@/lib/api';
import { queryKeys } from './keys';

/**
 * The register estate for a store running several tills.
 *
 * A location's `registerCount` is derived from its non-retired registers
 * (see `PostgresAdapter.getLocations`), so any mutation that creates or
 * retires a register invalidates `locations.all` alongside `registers.all` —
 * otherwise a manager who retires a till keeps seeing the old count on the
 * location card until an unrelated refetch happens to occur.
 */

export function useRegisters(filter?: RegisterListQuery) {
  return useQuery({
    queryKey: queryKeys.registers.list(filter),
    queryFn: () => registersApi.list(filter),
    staleTime: 30_000,
  });
}

export function useRegister(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.registers.detail(id ?? ''),
    queryFn: () => registersApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateRegisterRequest) => registersApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    },
  });
}

export function useUpdateRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRegisterRequest }) =>
      registersApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.all });
    },
  });
}

/** Permanent — see `registersApi.retire`. The confirmation belongs at the call site. */
export function useRetireRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => registersApi.retire(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    },
  });
}

export function useDisableRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => registersApi.disable(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.all });
    },
  });
}

export function useActivateRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => registersApi.activate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.registers.all });
    },
  });
}

export function useLocations() {
  return useQuery({
    queryKey: queryKeys.locations.all,
    queryFn: () => locationsApi.list(),
    staleTime: 30_000,
  });
}

export function useLocation(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.locations.detail(id ?? ''),
    queryFn: () => locationsApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateLocationRequest) => locationsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLocationRequest }) =>
      locationsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    },
  });
}
