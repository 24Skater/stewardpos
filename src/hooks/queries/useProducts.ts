import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, type CreateProductRequest, type UpdateProductRequest } from '@/lib/api';
import { queryKeys } from './keys';

/**
 * The catalog.
 *
 * Products change rarely relative to how often the register re-reads them, so a
 * short stale window keeps a cashier's browsing from refetching on every focus
 * change without letting a price edit go unnoticed for long.
 */
export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products.all,
    queryFn: () => productsApi.list(),
    staleTime: 30_000,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.detail(id ?? ''),
    queryFn: () => productsApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateProductRequest) => productsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProductRequest }) =>
      productsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}
