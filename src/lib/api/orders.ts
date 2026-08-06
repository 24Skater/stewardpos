import { apiClient } from '../api-client';
import type { CreateOrderRequest, Order } from './types';

/**
 * Order endpoints (`backend/src/api/routes/orders.ts`).
 *
 * There is deliberately no update or delete: an order is an immutable financial
 * record, and corrections go through the returns flow instead.
 *
 * `create` currently posts client-computed totals. Phase 3 replaces that with an
 * intent the server reprices; both sides change together at that point.
 */
export const ordersApi = {
  list: () => apiClient.get<Order[]>('/api/orders'),
  get: (id: string) => apiClient.get<Order>(`/api/orders/${id}`),
  listByCustomerEmail: (email: string) =>
    apiClient.get<Order[]>(`/api/orders/customer/${encodeURIComponent(email)}`),
  create: (body: CreateOrderRequest) => apiClient.post<Order>('/api/orders', body),
};
