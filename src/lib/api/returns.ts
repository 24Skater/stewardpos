import { apiClient } from '../api-client';
import { qs } from './qs';
import type { Return, ReturnKind, ReturnStats, ReturnStatus } from './types';

export type ReturnCondition = 'good' | 'damaged' | 'defective' | 'opened';
export type RefundMethod = 'original_payment' | 'store_credit' | 'cash' | 'card';
export type ReturnReasonCode = 'defective' | 'wrong_item' | 'not_needed' | 'damaged' | 'other';

export interface CreateReturnItem {
  originalOrderItemId?: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  originalQuantity: number;
  returnQuantity: number;
  unitPrice: number;
  lineTotal: number;
  condition?: ReturnCondition;
  notes?: string;
}

export interface CreateReturnRequest {
  originalOrderId: string;
  returnType?: ReturnKind;
  customerEmail?: string;
  customerPhone?: string;
  customerId?: string;
  items: CreateReturnItem[];
  subtotal: number;
  taxTotal?: number;
  total: number;
  refundMethod?: RefundMethod;
  reasonCode?: ReturnReasonCode;
  reasonDetails?: string;
  internalNotes?: string;
  restockItems?: boolean;
  restockingFee?: number;
}

export interface ReturnListQuery {
  status?: ReturnStatus;
  startDate?: number;
  endDate?: number;
  customerId?: string;
}

/** Returns and refunds (`backend/src/api/routes/returns.ts`). */
export const returnsApi = {
  list: (query?: ReturnListQuery) => apiClient.get<Return[]>(`/api/returns${qs(query)}`),
  stats: (range?: { startDate?: number; endDate?: number }) =>
    apiClient.get<ReturnStats>(`/api/returns/stats${qs(range)}`),
  get: (id: string) => apiClient.get<Return>(`/api/returns/${id}`),
  listByOrder: (orderId: string) => apiClient.get<Return[]>(`/api/returns/order/${orderId}`),
  listByCustomer: (customerId: string) =>
    apiClient.get<Return[]>(`/api/returns/customer/${customerId}`),
  create: (body: CreateReturnRequest) => apiClient.post<Return>('/api/returns', body),
  setStatus: (id: string, status: ReturnStatus, internalNotes?: string) =>
    apiClient.put<Return>(`/api/returns/${id}/status`, { status, internalNotes }),
  processRefund: (
    id: string,
    body: { refundMethod: RefundMethod; amount?: number; notes?: string }
  ) => apiClient.post<Return>(`/api/returns/${id}/process-refund`, body),
  /** Restocks every item on the return, or only `itemIds` when given. */
  restock: (id: string, itemIds?: string[]) =>
    apiClient.post<Return>(`/api/returns/${id}/restock`, { itemIds }),
};
