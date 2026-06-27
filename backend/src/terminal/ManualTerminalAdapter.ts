import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

type StoredStatus = 'pending' | 'approved' | 'cancelled';

export class ManualTerminalAdapter implements TerminalPort {
  private charges = new Map<string, StoredStatus>();

  async createCharge(
    _amount: number,
    _currency: string,
    _meta: ChargeMeta
  ): Promise<ChargeResult> {
    await delay(100);
    const chargeId = `manual_${randomUUID()}`;
    this.charges.set(chargeId, 'pending');
    return { chargeId, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    await delay(100);
    const stored = this.charges.get(chargeId);
    if (!stored) return { chargeId, status: 'error', errorMessage: 'Charge not found' };

    const status = stored === 'pending' ? 'approved' : stored;
    if (stored === 'pending') this.charges.set(chargeId, 'approved');

    return {
      chargeId,
      status,
      authCode: status === 'approved' ? 'MANUAL' : undefined,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    this.charges.set(chargeId, 'cancelled');
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
