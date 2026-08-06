import { apiClient } from '../api-client';
import type { CreateProductRequest, Product, UpdateProductRequest } from './types';

/**
 * Catalog endpoints (`backend/src/api/routes/products.ts`).
 *
 * Reads are public; writes require a bearer token, which `apiClient` attaches.
 * Note the asymmetry the backend enforces: `create` accepts nested `variants`,
 * `update` does not — variant edits go through a product replace today. Adding
 * a variant-level endpoint is Phase 4 work.
 */
export const productsApi = {
  list: () => apiClient.get<Product[]>('/api/products'),
  get: (id: string) => apiClient.get<Product>(`/api/products/${id}`),
  create: (body: CreateProductRequest) => apiClient.post<Product>('/api/products', body),
  update: (id: string, body: UpdateProductRequest) =>
    apiClient.put<Product>(`/api/products/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/products/${id}`),
};
