import { SquareClient, SquareEnvironment } from 'square';
import type { Currency } from 'square';
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader, ConnectionTestResult } from './TerminalPort';

interface SquareConfig {
  accessToken: string;
  locationId: string;
  deviceId: string;
  sandbox?: boolean;
}

const SQUARE_TO_CHARGE_STATUS: Record<string, ChargeResult['status']> = {
  PENDING: 'pending',
  IN_PROGRESS: 'pending',
  COMPLETED: 'approved',
  CANCELED: 'cancelled',
  CANCEL_REQUESTED: 'cancelled',
};

const DEVICE_STATUS_TO_READER_STATUS: Record<string, TerminalReader['status']> = {
  AVAILABLE: 'online',
  NEEDS_ATTENTION: 'error',
  OFFLINE: 'offline',
};

export class SquareTerminalAdapter implements TerminalPort {
  private client: SquareClient;
  private deviceId: string;

  constructor(config: SquareConfig) {
    this.client = new SquareClient({
      token: config.accessToken,
      environment: config.sandbox ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
    });
    this.deviceId = config.deviceId;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const response = await this.client.terminal.checkouts.create({
      idempotencyKey: randomUUID(),
      checkout: {
        amountMoney: { amount: BigInt(amount), currency: currency as Currency },
        deviceOptions: { deviceId: meta.readerId ?? this.deviceId },
        note: meta.description,
      },
    });

    if (response.errors?.length || !response.checkout) {
      return {
        chargeId: '',
        status: 'error',
        errorMessage: response.errors?.[0]?.detail ?? 'Failed to create checkout',
      };
    }

    return { chargeId: response.checkout.id!, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const response = await this.client.terminal.checkouts.get({ checkoutId: chargeId });

    if (response.errors?.length || !response.checkout) {
      return {
        chargeId,
        status: 'error',
        errorMessage: response.errors?.[0]?.detail ?? 'Checkout not found',
      };
    }

    const status = SQUARE_TO_CHARGE_STATUS[response.checkout.status ?? ''] ?? 'error';

    return {
      chargeId,
      status,
      authCode: response.checkout.paymentIds?.[0],
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.client.terminal.checkouts.cancel({ checkoutId: chargeId });
  }

  async listReaders(): Promise<TerminalReader[]> {
    const page = await this.client.devices.list();
    return page.data.map((device) => ({
      id: device.id ?? device.attributes.manufacturersId ?? '',
      label: device.attributes.name ?? device.id ?? '',
      status: DEVICE_STATUS_TO_READER_STATUS[device.status?.category ?? ''] ?? 'offline',
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.client.locations.list();
      return { success: true, message: 'Connected to Square' };
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
