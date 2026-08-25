import { randomUUID } from 'crypto';
import type {
  TerminalPort,
  ChargeResult,
  ChargeMeta,
  TerminalReader,
  RefundRequest,
  RefundResult,
} from './TerminalPort';

type StoredStatus = 'pending' | 'approved' | 'cancelled';

// module-level store — persists across requests
const chargeStore = new Map<string, StoredStatus>();

export class ManualTerminalAdapter implements TerminalPort {
  async createCharge(
    _amount: number,
    _currency: string,
    _meta: ChargeMeta
  ): Promise<ChargeResult> {
    await delay(100);
    const chargeId = `manual_${randomUUID()}`;
    chargeStore.set(chargeId, 'pending');
    return { chargeId, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    await delay(100);
    const stored = chargeStore.get(chargeId);
    if (!stored) return { chargeId, status: 'error', errorMessage: 'Charge not found' };

    const status = stored === 'pending' ? 'approved' : stored;
    if (stored === 'pending') chargeStore.set(chargeId, 'approved');

    return {
      chargeId,
      status,
      authCode: status === 'approved' ? 'MANUAL' : undefined,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    chargeStore.set(chargeId, 'cancelled');
  }

  /**
   * Acknowledge the refund, because there is no processor to ask.
   *
   * A manual tender means the card was run somewhere else entirely — a
   * standalone terminal, or nothing at all in development. Whoever refunds it
   * does so there; recording it here is the whole job.
   */
  async refundCharge(request: RefundRequest): Promise<RefundResult> {
    await delay(100);
    return {
      refundId: `manual_refund_${randomUUID()}`,
      status: 'succeeded',
      amount: request.amount ?? 0,
    };
  }

  async listReaders(): Promise<TerminalReader[]> {
    return [{ id: 'manual-reader-1', label: 'Manual / Dev Terminal', status: 'online' }];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Manual terminal — always connected (dev mode)' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
