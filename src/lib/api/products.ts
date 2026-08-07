import { apiClient } from '../api-client';
import { qs } from './qs';
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
export interface ProductQuery {
  /** Matches name, product barcode, and variant SKU/barcode, case-insensitively. */
  q?: string;
  category?: string;
  /** Opt-in. Omitted, the whole catalog comes back — see `list`. */
  limit?: number;
  offset?: number;
}

export const productsApi = {
  /**
   * The catalog.
   *
   * Without `limit` this returns everything, deliberately: a silent default cap
   * would drop products off the end of the register with nothing to indicate it,
   * so the failure would look like a missing product rather than a short page.
   */
  list: (query?: ProductQuery) => apiClient.get<Product[]>(`/api/products${qs(query)}`),
  /** The catalog with its total, for a paged view. */
  listPage: (query: ProductQuery) =>
    apiClient.getList<Product[]>(`/api/products${qs(query)}`),
  /**
   * Resolve a scanned barcode, and the specific variant it names.
   *
   * Exact match: the underlying search is a substring one, so `123` must not
   * ring up an item barcoded `1234`.
   */
  byBarcode: (code: string) =>
    apiClient.get<{ product: Product; variant: ProductVariant | null }>(
      `/api/products/barcode/${encodeURIComponent(code)}`
    ),
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
