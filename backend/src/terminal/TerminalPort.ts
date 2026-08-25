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

/**
 * Sending money back to the card it came from.
 *
 * Distinct from `cancelCharge`, which only releases an authorisation that was
 * never captured. Once a sale is captured — which is every completed sale
 * today — the only way back is a refund against the original charge.
 */
export interface RefundRequest {
  /** The processor's id for the original payment; `orders.card_transaction_id`. */
  chargeId: string;
  /**
   * How much to send back, in the currency's **minor unit**.
   *
   * Omitted means the whole payment. That is deliberate rather than a
   * convenience: passing a total we computed ourselves would put our own
   * rounding between the customer and their money, and the processor already
   * knows to the cent what it took.
   */
  amount?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  /**
   * A stable key for this refund, so a retried request cannot pay out twice.
   *
   * Refunds are the one operation where a duplicate is unrecoverable by us —
   * the money is gone and getting it back is the customer's goodwill, not an
   * API call.
   */
  idempotencyKey?: string;
}

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface RefundResult {
  refundId: string;
  status: RefundStatus;
  /** What the processor actually refunded, in minor units. */
  amount: number;
  failureReason?: string;
}

export interface TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  /** Throws {@link RefundNotSupportedError} on providers without an implementation. */
  refundCharge(request: RefundRequest): Promise<RefundResult>;
  listReaders(): Promise<TerminalReader[]>;
  testConnection(): Promise<ConnectionTestResult>;
}
