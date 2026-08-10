import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type UpdateSettingsRequest } from '@/lib/api';
import { queryKeys } from './keys';

/**
 * Store settings — tax rate, branding, receipt copy.
 *
 * Long stale time: these are edited by an admin now and then, but read by the
 * register on essentially every screen.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => adminApi.settings.get(),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => adminApi.settings.update(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}
