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

export interface TerminalReader {
  id: string;
  label: string;
  status: string;
}

export interface TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  listReaders(): Promise<TerminalReader[]>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}
