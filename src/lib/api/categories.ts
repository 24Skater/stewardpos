import { apiClient } from '../api-client';

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  /** How many products are in it — what makes a delete refusal explicable. */
  productCount: number;
}

export interface CategoryInput {
  name: string;
  icon?: string | null;
}

/** A category name products use that no category row defines. */
export interface UnmanagedCategory {
  name: string;
  productCount: number;
}

/**
 * Category endpoints (`backend/src/api/routes/categories.ts`).
 *
 * `products.category` stores the category *name*, so a rename moves every
 * product with it and a delete is refused while any remain — see `remove`.
 */
export const categoriesApi = {
  list: () => apiClient.get<Category[]>('/api/categories'),
  /**
   * The list plus `meta.unmanaged` — names products use that no category
   * defines, which a manager otherwise cannot see and therefore cannot fix.
   */
  listWithUnmanaged: () =>
    apiClient.getList<Category[], { total: number; unmanaged: UnmanagedCategory[] }>(
      '/api/categories'
    ),
  create: (body: CategoryInput) => apiClient.post<Category>('/api/categories', body),
  /** Renaming carries the products across; the response says how many moved. */
  update: (id: string, body: CategoryInput) =>
    apiClient.put<Category>(`/api/categories/${id}`, body),
  /**
   * Refused with a 409 while products are still in it. Pass `reassignTo` — an
   * existing category's name — to move them first and delete in one step.
   */
  remove: (id: string, reassignTo?: string) =>
    apiClient.delete<null>(
      `/api/categories/${id}${reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : ''}`
    ),
};
