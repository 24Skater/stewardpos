import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader, ConnectionTestResult } from './TerminalPort';

interface CloverConfig {
  apiToken: string;
  merchantId: string;
  deviceId: string;
}

export class CloverTerminalAdapter implements TerminalPort {
  private apiToken: string;
  private merchantId: string;
  private deviceId: string;
  private baseUrl = 'https://api.clover.com';

  constructor(config: CloverConfig) {
    this.apiToken = config.apiToken;
    this.merchantId = config.merchantId;
    this.deviceId = config.deviceId;
  }

  private async cloverFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Clover API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, _currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.cloverFetch<{ id: string }>(
      `/v3/merchants/${this.merchantId}/remote_pay`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount,
          externalId: meta.orderId || randomUUID(),
          type: 'SALE',
          deviceId: meta.readerId || this.deviceId,
        }),
      }
    );
    return { chargeId: data.id, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.cloverFetch<{
      result: string;
      authCode?: string;
      message?: string;
    }>(`/v3/merchants/${this.merchantId}/remote_pay/${chargeId}`);

    const cloverToStatus: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      VOIDED: 'cancelled',
    };

    return {
      chargeId,
      status: cloverToStatus[data.result] ?? 'error',
      authCode: data.authCode,
      errorMessage: data.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.cloverFetch(`/v3/merchants/${this.merchantId}/remote_pay/${chargeId}`, {
      method: 'DELETE',
    });
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.cloverFetch<{ elements: Array<{ id: string; name?: string; online?: boolean }> }>(
      `/v3/merchants/${this.merchantId}/devices`
    );
    return (data.elements ?? []).map((d) => ({
      id: d.id,
      label: d.name || d.id,
      status: (d.online ? 'online' : 'offline') as TerminalReader['status'],
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.cloverFetch(`/v3/merchants/${this.merchantId}`);
      return { success: true, message: 'Connected to Clover' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
