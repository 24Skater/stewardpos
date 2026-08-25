import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader, ConnectionTestResult, RefundRequest, RefundResult } from './TerminalPort';
import { RefundNotSupportedError } from './errors';

interface VerifoneConfig {
  apiKey: string;
  merchantId: string;
  terminalId: string;
}

export class VerifoneTerminalAdapter implements TerminalPort {
  private apiKey: string;
  private merchantId: string;
  private terminalId: string;
  private baseUrl = 'https://api.verifone.com/v1';

  constructor(config: VerifoneConfig) {
    this.apiKey = config.apiKey;
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
  }

  private async verifoneFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Verifone API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.verifoneFetch<{ transactionId: string }>(
      '/transactions',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: (amount / 100).toFixed(2),
          currency,
          terminalId: meta.readerId || this.terminalId,
          merchantId: this.merchantId,
          referenceId: meta.orderId || randomUUID(),
          transactionType: 'sale',
        }),
      }
    );
    return { chargeId: data.transactionId, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.verifoneFetch<{
      status: string;
      authorizationCode?: string;
      responseMessage?: string;
    }>(`/transactions/${chargeId}`);

    const verifoneToStatus: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      PROCESSING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      VOIDED: 'cancelled',
      CANCELLED: 'cancelled',
    };

    return {
      chargeId,
      status: verifoneToStatus[data.status] ?? 'error',
      authCode: data.authorizationCode,
      errorMessage: data.responseMessage,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.verifoneFetch(`/transactions/${chargeId}/void`, {
      method: 'POST',
      body: '{}',
    });
  }

  /** Not implemented for Verifone — see {@link RefundNotSupportedError}. */
  async refundCharge(_request: RefundRequest): Promise<RefundResult> {
    throw new RefundNotSupportedError('Verifone');
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.verifoneFetch<{
      terminals: Array<{ terminalId: string; name?: string; status?: string }>;
    }>(`/terminals?merchantId=${this.merchantId}`);
    return (data.terminals ?? []).map((t) => ({
      id: t.terminalId,
      label: t.name || t.terminalId,
      status: (t.status?.toLowerCase() || 'offline') as TerminalReader['status'],
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.verifoneFetch(`/merchants/${this.merchantId}`);
      return { success: true, message: 'Connected to Verifone' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
