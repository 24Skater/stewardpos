import { apiClient } from '../api-client';

export type StoreCreditStatus = 'active' | 'used' | 'expired' | 'cancelled';

export interface StoreCredit {
  id: string;
  customerId?: string;
  customerEmail?: string;
  /** The return that issued it. */
  returnId?: string;
  code: string;
  originalAmount: number;
  /** What is left to spend — partial redemption is supported. */
  remainingAmount: number;
  status: StoreCreditStatus;
  expiresAt?: number | null;
  createdAt: number;
  usedAt?: number | null;
  usedOrderId?: string;
}

/**
 * Store credit (`backend/src/api/routes/storeCredits.ts`).
 *
 * A refund taken as store credit issues a code. These are what make that code
 * worth anything: before them a credit could be created and never looked up or
 * spent.
 *
 * `redeem` refuses in a single conditional update rather than checking the
 * balance first, so two registers presented with the same code cannot both
 * spend it.
 */
export const storeCreditsApi = {
  get: (code: string) => apiClient.get<StoreCredit>(`/api/store-credits/${encodeURIComponent(code)}`),
  redeem: (code: string, amount: number, orderId?: string) =>
    apiClient.post<StoreCredit>(`/api/store-credits/${encodeURIComponent(code)}/redeem`, {
      amount,
      orderId,
    }),
};
