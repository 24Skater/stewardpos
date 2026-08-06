import { apiClient } from '../api-client';
import type { CreateCustomerRequest, Customer, UpdateCustomerRequest } from './types';

/**
 * Customer endpoints (`backend/src/api/routes/customers.ts`).
 *
 * `remove` refuses to delete a customer with related orders and throws an
 * `ApiClientError` carrying `hasRelatedRecords` on its `body`; `archive` is the
 * intended fallback, and `purge` is the admin-only, irreversible override that
 * also drops the related records.
 */
export const customersApi = {
  list: () => apiClient.get<Customer[]>('/api/customers'),
  get: (id: string) => apiClient.get<Customer>(`/api/customers/${id}`),
  create: (body: CreateCustomerRequest) => apiClient.post<Customer>('/api/customers', body),
  update: (id: string, body: UpdateCustomerRequest) =>
    apiClient.put<Customer>(`/api/customers/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/api/customers/${id}`),
  archive: (id: string) => apiClient.post<Customer>(`/api/customers/${id}/archive`),
  /** Admin only, irreversible: deletes the customer and every related record. */
  purge: (id: string) => apiClient.delete<void>(`/api/customers/${id}/permanent`),
};
