import { apiClient } from '../api-client';

/** Mirrors `ChargeStatus` in `backend/src/terminal/TerminalPort.ts`. */
export type ChargeStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'error';

export interface TerminalCharge {
  chargeId: string;
  status: ChargeStatus;
  authCode?: string;
  errorMessage?: string;
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
   * Amount in the currency's **minor unit** (cents) — the one place in the
   * client that is not dollars, because card processors bill in integers.
   */
  amount: number;
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
