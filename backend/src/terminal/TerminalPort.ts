export type ChargeStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'error';

export interface ChargeMeta {
  orderId?: string;
  readerId?: string;
  description?: string;
}

export interface ChargeResult {
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

export interface TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  listReaders(): Promise<TerminalReader[]>;
  testConnection(): Promise<ConnectionTestResult>;
}
