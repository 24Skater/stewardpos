import { apiClient } from '../api-client';
import type {
  CreateProductRequest,
  Product,
  ProductVariant,
  UpdateProductRequest,
} from './types';

/** A variant as the API accepts it — no `id`, which the server assigns. */
export type VariantInput = Omit<ProductVariant, 'id'>;

/**
 * Catalog endpoints (`backend/src/api/routes/products.ts`).
 *
 * Reads are public; writes require a bearer token, which `apiClient` attaches.
 * `create` accepts nested variants; `update` does not. Variant edits go through
 * the `variants` sub-resource, which is what lets a stock count be corrected
 * without recreating the product.
 */
export const productsApi = {
  list: () => apiClient.get<Product[]>('/api/products'),
  get: (id: string) => apiClient.get<Product>(`/api/products/${id}`),
  create: (body: CreateProductRequest) => apiClient.post<Product>('/api/products', body),
  update: (id: string, body: UpdateProductRequest) =>
    apiClient.put<Product>(`/api/products/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/products/${id}`),

  /**
   * Variant sub-resources.
   *
   * `update` sends only what changed — the server COALESCEs the rest, so
   * correcting a stock count does not blank the size or barcode. A product's
   * last variant cannot be removed; disable it instead.
   */
  variants: {
    create: (productId: string, body: VariantInput) =>
      apiClient.post<ProductVariant>(`/api/products/${productId}/variants`, body),
    update: (productId: string, variantId: string, body: Partial<VariantInput>) =>
      apiClient.put<ProductVariant>(`/api/products/${productId}/variants/${variantId}`, body),
    remove: (productId: string, variantId: string) =>
      apiClient.delete<void>(`/api/products/${productId}/variants/${variantId}`),
  },
};
