import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi, type CreateOrderRequest } from '@/lib/api';
import { queryKeys } from './keys';

export function useOrders() {
  return useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: () => ordersApi.list(),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn: () => ordersApi.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Post a completed sale.
 *
 * Also invalidates products: an order decrements variant stock server-side, so a
 * catalog left cached here would show a cashier quantities that no longer exist.
 */
export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateOrderRequest) => ordersApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}
