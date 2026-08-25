import { apiClient } from '../api-client';
import { qs } from './qs';

/**
 * Card payments that took money and never became a sale.
 *
 * Backed by `backend/src/api/routes/reconciliation.ts`. Every field here is the
 * server's record of a charge it made, so nothing in it is computed client-side.
 */
export interface UnreconciledPayment {
  id: string;
  chargeId: string | null;
  /** What was charged, in minor units — the processor's unit, not dollars. */
  amountCents: number;
  currency: string;
  status: 'pending' | 'authorized' | 'completed' | 'failed' | 'cancelled';
  registerId: string | null;
  cashierUserId: string | null;
  orderId: string | null;
  failureReason: string | null;
  /** The priced cart as it stood, so the charge says what it was for. */
  cartSnapshot: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface RecheckResult {
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'error';
  attempt: UnreconciledPayment | null;
}

export const reconciliationApi = {
  list: (params?: { withinMinutes?: number; limit?: number }) =>
    apiClient.get<UnreconciledPayment[]>(`/api/admin/reconciliation${qs(params ?? {})}`),

  /** Ask the processor what actually happened to a charge we lost track of. */
  recheck: (id: string) =>
    apiClient.post<RecheckResult>(`/api/admin/reconciliation/${id}/recheck`),

  /** Give the whole charge back, for a payment whose sale was never rung. */
  refund: (id: string) =>
    apiClient.post<{ refundId: string; status: string }>(
      `/api/admin/reconciliation/${id}/refund`
    ),

  /** Record that a human looked and it needs nothing further. */
  dismiss: (id: string, reason: string) =>
    apiClient.post<void>(`/api/admin/reconciliation/${id}/dismiss`, { reason }),
};
