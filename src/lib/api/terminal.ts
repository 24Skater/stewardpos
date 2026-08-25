import { apiClient } from '../api-client';

/** Mirrors `ChargeStatus` in `backend/src/terminal/TerminalPort.ts`. */
export type ChargeStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'error';

export interface TerminalCharge {
  chargeId: string;
  status: ChargeStatus;
  authCode?: string;
  /** The issuer's reason on a decline — `insufficient_funds`, `lost_card`. */
  declineCode?: string;
  errorMessage?: string;
  /**
   * The server's record of this payment, to hand back when creating the order.
   * It is what ties the money taken to the sale written down.
   */
  attemptId?: string;
  /** What the server actually charged, in minor units. */
  amount?: number;
}

export type ReaderStatus = 'online' | 'offline' | 'ready' | 'initializing' | 'error';

export interface TerminalReader {
  id: string;
  label: string;
  status: ReaderStatus;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface CreateChargeRequest {
  /**
   * What is being sold. Deliberately not an amount: the server prices the cart
   * and derives the figure that reaches the card, so the till cannot name a
   * price for its own sale.
   */
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    notes?: string;
  }>;
  appliedDiscounts?: Array<Record<string, unknown>>;
  /** The server takes the credit's share off the card, and checks it is usable. */
  storeCreditCode?: string;
  currency?: string;
  readerId?: string;
  description?: string;
}

/** Card-terminal endpoints (`backend/src/api/routes/terminal.ts`). All require auth. */
export const terminalApi = {
  charge: (body: CreateChargeRequest) => apiClient.post<TerminalCharge>('/api/terminal/charge', body),
  status: (chargeId: string) => apiClient.get<TerminalCharge>(`/api/terminal/status/${chargeId}`),
  cancel: (chargeId: string) => apiClient.post<void>(`/api/terminal/cancel/${chargeId}`),
  /** Admin only. */
  listReaders: () => apiClient.get<TerminalReader[]>('/api/terminal/readers'),
  /** Admin only: round-trips the configured provider to verify credentials. */
  test: () => apiClient.post<ConnectionTestResult>('/api/terminal/test'),
};
