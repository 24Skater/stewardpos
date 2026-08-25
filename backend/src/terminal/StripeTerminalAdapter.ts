import Stripe from 'stripe';
import { randomUUID } from 'crypto';
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
import { TerminalUnavailableError } from './errors';

/**
 * What a reader that refused the handoff means, and what to do about it.
 *
 * `cancelIntent` is the part that needs care. A reader that was busy or offline
 * never saw this payment, so its PaymentIntent is dead weight and cancelling it
 * keeps the account tidy. A *timeout* is different: Stripe documents it as a
 * possible false negative, where the command did reach the reader and the
 * customer may be tapping their card right now. Cancelling there would void a
 * payment in progress, so the intent is left alone and the operator checks.
 */
const READER_FAILURES: Record<
  string,
  { message: string; retryable: boolean; cancelIntent: boolean }
> = {
  terminal_reader_offline: {
    message:
      'The card reader is offline. Check that it is powered on and connected, or take another form of payment.',
    retryable: false,
    cancelIntent: true,
  },
  terminal_reader_busy: {
    message:
      'The card reader is busy with another payment. Wait for it to finish, or use a different reader.',
    retryable: true,
    cancelIntent: true,
  },
  terminal_reader_timeout: {
    message:
      'The card reader did not answer in time. Check the reader before trying again — it may already be asking for a card.',
    retryable: true,
    cancelIntent: false,
  },
};

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
    // Without a key a retry anywhere between here and the client — a proxy, a
    // load balancer, an impatient browser — creates a second PaymentIntent for
    // one sale. The caller's key covers that; the fallback at least keeps this
    // single request self-consistent if it is retried internally.
    const idempotencyKey = meta.idempotencyKey || randomUUID();

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: { description: meta.description || '', ...(meta.metadata ?? {}) },
      },
      { idempotencyKey }
    );

    try {
      await this.stripe.terminal.readers.processPaymentIntent(
        meta.readerId || this.readerId,
        { payment_intent: paymentIntent.id }
      );
    } catch (error) {
      await this.handleHandoffFailure(error, paymentIntent.id);
    }

    return { chargeId: paymentIntent.id, status: 'pending' };
  }

  /**
   * Turn a refused handoff into something the till can explain, and clean up.
   *
   * Always throws.
   */
  private async handleHandoffFailure(error: unknown, paymentIntentId: string): Promise<never> {
    const code = (error as { code?: string })?.code ?? '';
    const failure = READER_FAILURES[code];

    if (failure?.cancelIntent) {
      // Best effort: an intent we cannot cancel is untidy, never incorrect, and
      // must not replace the reader error the operator actually needs to see.
      await this.stripe.paymentIntents.cancel(paymentIntentId).catch(() => undefined);
    }

    if (failure) {
      throw new TerminalUnavailableError(code, failure.message, failure.retryable);
    }

    throw error;
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

    const charge = pi.latest_charge as Stripe.Charge | null;
    const authCode =
      charge?.payment_method_details?.card_present?.receipt?.authorization_code ?? undefined;
    const failure = pi.last_payment_error;

    /**
     * A declined card returns the intent to `requires_payment_method` — the
     * same status it had before anyone tapped anything. Reading that as
     * `pending` meant the POS polled on until its 90-second timeout while the
     * customer waited, and never showed the reason at all. What separates the
     * two is `last_payment_error`: present only once an attempt has failed.
     */
    const status: ChargeResult['status'] =
      pi.status === 'requires_payment_method' && failure
        ? 'declined'
        : stripeToStatus[pi.status] ?? 'error';

    return {
      chargeId,
      status,
      authCode,
      // `decline_code` is the issuer's reason and the useful one; `code` is
      // Stripe's own and covers failures the issuer never saw.
      declineCode: failure?.decline_code ?? failure?.code,
      errorMessage: failure?.message,
    };
  }

  /**
   * Stop the payment, and put the reader back.
   *
   * Cancelling only the PaymentIntent left the reader lit and still asking for
   * a card, so the next sale met `terminal_reader_busy` — a cancelled sale
   * quietly broke the following one.
   *
   * Reader first, then the intent: resetting the screen is what the customer
   * sees, and cancelling the intent is what must happen regardless. A reader
   * that will not reset — offline, or simply idle with no action to cancel — is
   * not a reason to leave money authorised, so that failure is swallowed.
   */
  async cancelCharge(chargeId: string): Promise<void> {
    if (this.readerId) {
      await this.stripe.terminal.readers.cancelAction(this.readerId).catch(() => undefined);
    }
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
