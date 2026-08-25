import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import db from '../../services/database';
import logger from '../../utils/logger';
import { recordChargeOutcome } from '../../services/paymentOutcome';
import type { ChargeStatus } from '../../terminal/TerminalPort';

/**
 * Stripe's own account of what happened, delivered rather than asked for.
 *
 * Deliberately unauthenticated in the usual sense: Stripe has no session and no
 * API key of ours. The signature *is* the authentication, and it is the only
 * thing standing between this route and an attacker marking arbitrary payments
 * as approved — so an unverified request is refused before anything else looks
 * at the body.
 *
 * Mounted with a raw body parser ahead of the global JSON one, because
 * verification hashes the exact bytes Stripe sent. Any reserialisation, however
 * faithful it looks, changes them and the signature stops matching.
 */

const router = Router();

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
async function signingSecret(): Promise<string | null> {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;

  const settings = await db.getAdapter().getSettings();
  const config = (settings?.config as Record<string, unknown>) || {};
  const credentials = (config.terminalCredentials || {}) as Record<string, unknown>;
  const secret = credentials.stripeWebhookSecret;
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

router.post('/stripe', async (req: Request, res: Response) => {
  const secret = await signingSecret();
  if (!secret) {
    // Accepting unverified events because we have no secret configured would be
    // strictly worse than not listening at all.
    logger.error('Stripe webhook received but no signing secret is configured');
    return res.status(503).json({ error: 'Webhooks are not configured' });
  }

  const signature = req.headers['stripe-signature'];
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      req.body as Buffer,
      typeof signature === 'string' ? signature : '',
      secret
    );
  } catch (error) {
    logger.warn(
      `Rejected a Stripe webhook: ${error instanceof Error ? error.message : 'bad signature'}`
    );
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const adapter = db.getAdapter();
  const chargeId = chargeIdOf(event);

  /**
   * Claim the event before doing anything with it.
   *
   * The insert is the deduplication: a redelivery collides on the primary key
   * and we stop. Done as a write rather than a read-then-write because two
   * deliveries can arrive at the same instant, and a check that is separate
   * from the claim lets both pass it.
   */
  const claimed = await adapter.claimWebhookEvent({ id: event.id, type: event.type, chargeId });
  if (!claimed) {
    logger.info(`Ignoring duplicate Stripe event ${event.id}`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  if (!HANDLED_EVENTS.has(event.type) || !chargeId) {
    await adapter.markWebhookEventHandled(event.id);
    return res.status(200).json({ received: true });
  }

  try {
    if (event.type === 'refund.failed') {
      // A refund can fail asynchronously long after Stripe accepted it, which
      // is the one case where our records say a customer was repaid and they
      // were not.
      const refund = event.data.object as unknown as Record<string, unknown>;
      await adapter.markRefundFailed(String(refund.id), (refund.failure_reason as string) ?? null);
      logger.error(
        `Refund ${refund.id} failed at Stripe: ${refund.failure_reason ?? 'no reason given'}`
      );
    } else {
      const outcome = outcomeOf(event);
      if (outcome) {
        await recordChargeOutcome(adapter, { chargeId, ...outcome });
      }
    }

    await adapter.markWebhookEventHandled(event.id);
  } catch (error) {
    // The event is already claimed, so it will not be retried into this handler
    // by a redelivery. Recording why it failed is what makes it findable.
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to handle Stripe event ${event.id}: ${message}`);
    await adapter.markWebhookEventHandled(event.id, message).catch(() => undefined);
  }

  // Always 200 once the signature checked out. A non-2xx tells Stripe to retry,
  // and retrying an event we have already claimed cannot achieve anything.
  return res.status(200).json({ received: true });
});

export default router;
