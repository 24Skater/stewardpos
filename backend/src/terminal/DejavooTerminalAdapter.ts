import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader, ConnectionTestResult, RefundRequest, RefundResult } from './TerminalPort';
import { RefundNotSupportedError } from './errors';

interface DejavooConfig {
  apiKey: string;
  merchantId: string;
  terminalId: string;
}

export class DejavooTerminalAdapter implements TerminalPort {
  private apiKey: string;
  private merchantId: string;
  private terminalId: string;
  private baseUrl = 'https://cloud.dejavoo.com/api/v1';

  constructor(config: DejavooConfig) {
    this.apiKey = config.apiKey;
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
  }

  private async dejavooFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Dejavoo API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.dejavooFetch<{ refNum?: string; id?: string }>(
      '/payment/sale',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: (amount / 100).toFixed(2),
          currency,
          terminalId: meta.readerId || this.terminalId,
          merchantId: this.merchantId,
          invoiceNumber: (meta.orderId || randomUUID()).slice(0, 8),
        }),
      }
    );
    return { chargeId: data.refNum || data.id || '', status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.dejavooFetch<{
      result?: string;
      authCode?: string;
      message?: string;
    }>(`/payment/status/${chargeId}`);

    const dejavooToStatus: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      CANCELLED: 'cancelled',
      VOIDED: 'cancelled',
    };

    return {
      chargeId,
      status: dejavooToStatus[(data.result ?? '').toUpperCase()] ?? 'error',
      authCode: data.authCode,
      errorMessage: data.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.dejavooFetch(`/payment/void/${chargeId}`, { method: 'POST', body: '{}' });
  }

  /** Not implemented for Dejavoo — see {@link RefundNotSupportedError}. */
  async refundCharge(_request: RefundRequest): Promise<RefundResult> {
    throw new RefundNotSupportedError('Dejavoo');
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.dejavooFetch<{
      terminals: Array<{ terminalId?: string; id?: string; name?: string; online?: boolean }>;
    }>(`/terminals?merchantId=${this.merchantId}`);
    return (data.terminals ?? []).map((t) => ({
      id: t.terminalId || t.id || '',
      label: t.name || t.terminalId || t.id || '',
      status: (t.online ? 'online' : 'offline') as TerminalReader['status'],
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.dejavooFetch(`/ping?merchantId=${this.merchantId}`);
      return { success: true, message: 'Connected to Dejavoo' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
