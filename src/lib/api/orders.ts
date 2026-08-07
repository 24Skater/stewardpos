import { apiClient } from '../api-client';
import type { CreateOrderRequest, Order, QuoteCartRequest, QuotedCart } from './types';

/**
 * Order endpoints (`backend/src/api/routes/orders.ts`).
 *
 * There is deliberately no update or delete: an order is an immutable financial
 * record, and corrections go through the returns flow instead.
 *
 * The server reprices every sale: `create` accepts the client's money fields for
 * compatibility and discards them. To take money off, name the discounts in
 * `appliedDiscounts` — a bare `discountTotal` is not believed.
 */
export const ordersApi = {
  list: () => apiClient.get<Order[]>('/api/orders'),
  get: (id: string) => apiClient.get<Order>(`/api/orders/${id}`),
  listByCustomerEmail: (email: string) =>
    apiClient.get<Order[]>(`/api/orders/customer/${encodeURIComponent(email)}`),
  create: (body: CreateOrderRequest) => apiClient.post<Order>('/api/orders', body),
  /**
   * What a cart will cost, without committing to it.
   *
   * Shares the server's pricing path with `create`, so the quote is by
   * construction what the sale will charge. Call it before authorising a card:
   * the terminal has to be sent the authoritative amount, and a discount the
   * server declines is far better surfaced here than after the customer's card
   * is already charged.
   */
  quote: (body: QuoteCartRequest) => apiClient.post<QuotedCart>('/api/orders/quote', body),
};
