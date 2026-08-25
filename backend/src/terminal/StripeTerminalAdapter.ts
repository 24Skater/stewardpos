import Stripe from 'stripe';
import type {
  TerminalPort,
  ChargeResult,
  ChargeMeta,
  TerminalReader,
  ConnectionTestResult,
  RefundRequest,
  RefundResult,
  RefundStatus,
} from './TerminalPort';

/**
 * Stripe's refund states, in our vocabulary.
 *
 * `pending` and `requires_action` both mean "not yet money"; a refund can also
 * fail asynchronously well after the API call returned success, which is what
 * the `refund.failed` webhook exists for.
 */
const STRIPE_TO_REFUND_STATUS: Record<string, RefundStatus> = {
  succeeded: 'succeeded',
  pending: 'pending',
  requires_action: 'pending',
  failed: 'failed',
  canceled: 'cancelled',
};

interface StripeConfig {
  secretKey: string;
  locationId: string;
  readerId: string;
}

export class StripeTerminalAdapter implements TerminalPort {
  private stripe: Stripe;
  private readerId: string;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, { apiVersion: '2026-06-24.dahlia' });
    this.readerId = config.readerId;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { description: meta.description || '' },
    });

    await this.stripe.terminal.readers.processPaymentIntent(
      meta.readerId || this.readerId,
      { payment_intent: paymentIntent.id }
    );

    return { chargeId: paymentIntent.id, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const pi = await this.stripe.paymentIntents.retrieve(chargeId, {
      expand: ['latest_charge'],
    });

    const stripeToStatus: Record<string, ChargeResult['status']> = {
      requires_payment_method: 'pending',
      requires_confirmation: 'pending',
      requires_action: 'pending',
      processing: 'pending',
      succeeded: 'approved',
      canceled: 'cancelled',
      requires_capture: 'pending',
    };

    const status = stripeToStatus[pi.status] ?? 'error';
    const charge = pi.latest_charge as Stripe.Charge | null;
    const authCode =
      charge?.payment_method_details?.card_present?.receipt?.authorization_code ?? undefined;

    return {
      chargeId,
      status,
      authCode,
      errorMessage: pi.last_payment_error?.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(chargeId);
  }

  async refundCharge(request: RefundRequest): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: request.chargeId,
        // Only sent for a partial refund. Stripe refunds the full charge when
        // `amount` is absent, which is more accurate than any total we compute.
        ...(request.amount !== undefined ? { amount: request.amount } : {}),
        reason: request.reason ?? 'requested_by_customer',
      },
      request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}
    );

    return {
      refundId: refund.id,
      status: STRIPE_TO_REFUND_STATUS[refund.status ?? ''] ?? 'pending',
      amount: refund.amount,
      ...(refund.failure_reason ? { failureReason: refund.failure_reason } : {}),
    };
  }

  async listReaders(): Promise<TerminalReader[]> {
    const readers = await this.stripe.terminal.readers.list({ limit: 100 });
    return readers.data.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      status: (r.status ?? 'offline') as TerminalReader['status'],
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.stripe.terminal.readers.list({ limit: 1 });
      return { success: true, message: 'Connected to Stripe Terminal' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
