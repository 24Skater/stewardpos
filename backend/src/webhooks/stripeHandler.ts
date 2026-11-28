import Stripe from 'stripe';
import type { IncomingHttpHeaders } from 'http';
import db from '../services/database';
import logger from '../utils/logger';
import { recordChargeOutcome } from '../services/paymentOutcome';
import { readTerminalCredentials } from '../services/terminalGateway';
import type { ChargeStatus } from '../terminal/TerminalPort';
import type { InboundEvent, InboundHandler, InboundSettings } from './registry';

/** The events this integration acts on. Anything else is acknowledged and dropped. */
const HANDLED_EVENTS = new Set([
  'terminal.reader.action_succeeded',
  'terminal.reader.action_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'refund.failed',
]);

/**
 * The webhook signing secret, from the environment or the shop's settings.
 *
 * Per-endpoint and per-account: each install registers its own webhook against
 * its own Stripe account, so this is never a value we can ship.
 */
function signingSecret(settings: InboundSettings): string | null {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;

  const secret = readTerminalCredentials(settings).stripeWebhookSecret;
  return typeof secret === 'string' && secret ? secret : null;
}

/** The charge an event concerns, wherever this particular event type keeps it. */
function chargeIdOf(event: Stripe.Event): string | undefined {
  const object = event.data.object as unknown as Record<string, unknown>;

  if (event.type.startsWith('payment_intent.')) {
    return object.id as string;
  }

  if (event.type.startsWith('terminal.reader.')) {
    const action = object.action as Record<string, unknown> | undefined;
    const process = action?.process_payment_intent as Record<string, unknown> | undefined;
    const confirm = action?.confirm_payment_intent as Record<string, unknown> | undefined;
    return (process?.payment_intent ?? confirm?.payment_intent) as string | undefined;
  }

  if (event.type === 'refund.failed') {
    return object.payment_intent as string | undefined;
  }

  return undefined;
}

/** What an event says about the payment, in the vocabulary the rest of the app uses. */
function outcomeOf(event: Stripe.Event): { status: ChargeStatus; failureReason?: string } | null {
  const object = event.data.object as unknown as Record<string, unknown>;

  switch (event.type) {
    case 'terminal.reader.action_succeeded':
    case 'payment_intent.succeeded':
      return { status: 'approved' };

    case 'terminal.reader.action_failed': {
      const action = object.action as Record<string, unknown> | undefined;
      return {
        status: 'declined',
        failureReason: (action?.failure_code as string) ?? undefined,
      };
    }

    case 'payment_intent.payment_failed': {
      const error = object.last_payment_error as Record<string, unknown> | undefined;
      return {
        status: 'declined',
        failureReason: (error?.decline_code ?? error?.code) as string | undefined,
      };
    }

    case 'payment_intent.canceled':
      return { status: 'cancelled' };

    default:
      return null;
  }
}

export const stripeHandler: InboundHandler = {
  provider: 'stripe',

  isConfigured: (settings) => signingSecret(settings) !== null,

  verify(rawBody: Buffer, headers: IncomingHttpHeaders, settings: InboundSettings): boolean {
    const secret = signingSecret(settings);
    if (!secret) return false;
    const signature = headers['stripe-signature'];
    try {
      Stripe.webhooks.constructEvent(rawBody, typeof signature === 'string' ? signature : '', secret);
      return true;
    } catch (error) {
      logger.warn(
        `Rejected a Stripe webhook: ${error instanceof Error ? error.message : 'bad signature'}`
      );
      return false;
    }
  },

  parse(rawBody: Buffer): InboundEvent {
    const event = JSON.parse(rawBody.toString('utf8')) as Stripe.Event;
    return { id: event.id, type: event.type, chargeId: chargeIdOf(event), payload: event };
  },

  async handle(inbound: InboundEvent): Promise<void> {
    const event = inbound.payload as Stripe.Event;
    const chargeId = inbound.chargeId;
    if (!HANDLED_EVENTS.has(event.type) || !chargeId) return;

    const adapter = db.getAdapter();
    if (event.type === 'refund.failed') {
      // A refund can fail asynchronously long after Stripe accepted it, which
      // is the one case where our records say a customer was repaid and they
      // were not.
      const refund = event.data.object as unknown as Record<string, unknown>;
      await adapter.markRefundFailed(String(refund.id), (refund.failure_reason as string) ?? null);
      logger.error(
        `Refund ${refund.id} failed at Stripe: ${refund.failure_reason ?? 'no reason given'}`
      );
      return;
    }

    const outcome = outcomeOf(event);
    if (outcome) {
      await recordChargeOutcome(adapter, { chargeId, ...outcome });
    }
  },
};
