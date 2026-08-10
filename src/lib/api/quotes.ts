import { apiClient } from '../api-client';
import type { Quote, QuoteStatus } from './types';

/** A quote line as the API accepts it — no `id`, which the server assigns. */
export interface QuoteItemInput {
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CreateQuoteRequest {
  customerId?: string;
  items: QuoteItemInput[];
  subtotal: number;
  taxTotal?: number;
  total: number;
  notes?: string;
  status?: QuoteStatus;
  expiresAt?: number;
}

export type UpdateQuoteRequest = Partial<CreateQuoteRequest>;

/**
 * Quote endpoints (`backend/src/api/routes/quotes.ts`).
 *
 * The Quotes/Services surface is deferred (D2) — these exist so the pages have a
 * real contract to bind to when that work resumes.
 */
export const quotesApi = {
  list: () => apiClient.get<Quote[]>('/api/quotes'),
  get: (id: string) => apiClient.get<Quote>(`/api/quotes/${id}`),
  listByCustomer: (customerId: string) =>
    apiClient.get<Quote[]>(`/api/quotes/customer/${customerId}`),
  create: (body: CreateQuoteRequest) => apiClient.post<Quote>('/api/quotes', body),
  update: (id: string, body: UpdateQuoteRequest) =>
    apiClient.put<Quote>(`/api/quotes/${id}`, body),
  setStatus: (id: string, status: QuoteStatus) =>
    apiClient.put<Quote>(`/api/quotes/${id}/status`, { status }),
  remove: (id: string) => apiClient.delete<void>(`/api/quotes/${id}`),
};
