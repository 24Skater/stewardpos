import { apiClient, type ResponseMeta } from '../api-client';
import { qs } from './qs';
import type { Order } from './types';

export interface ReceiptSearchQuery {
  query?: string;
  startDate?: number;
  endDate?: number;
  customerEmail?: string;
  minAmount?: number;
  maxAmount?: number;
  paymentMethod?: string;
  limit?: number;
  offset?: number;
}

export interface ReceiptEmailLog {
  id: string;
  orderId: string;
  recipientEmail: string;
  subject: string;
  receiptType: string;
  status: string;
  sentBy?: string;
  sentAt: number;
}

/**
 * Receipt endpoints (`backend/src/api/routes/receipts.ts`).
 *
 * A "receipt" is an order viewed through the customer-facing lens, so these
 * return {@link Order} rather than a distinct entity.
 */
export const receiptsApi = {
  /** Paginated by offset; the envelope's `meta` carries `hasMore`. */
  list: (page?: { limit?: number; offset?: number }): Promise<{ data: Order[]; meta?: ResponseMeta }> =>
    apiClient.getList<Order[]>(`/api/receipts${qs(page)}`),
  search: (query: ReceiptSearchQuery) => apiClient.get<Order[]>(`/api/receipts/search${qs(query)}`),
  get: (id: string) => apiClient.get<Order>(`/api/receipts/${id}`),
  resend: (id: string, email: string) =>
    apiClient.post<{ sentTo: string; receiptContent: unknown }>(`/api/receipts/${id}/resend`, {
      email,
    }),
  history: (id: string) => apiClient.get<ReceiptEmailLog[]>(`/api/receipts/${id}/history`),
  /** Returns the order pre-shaped as returnable line items. */
  startReturn: (id: string) => apiClient.post<unknown>(`/api/receipts/${id}/start-return`),
};
