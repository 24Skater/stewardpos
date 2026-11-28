import { Router, Request, Response } from 'express';
import db from '../../services/database';
import logger from '../../utils/logger';
import { getHandler, registerHandler } from '../../webhooks/registry';
import type { InboundEvent } from '../../webhooks/registry';
import { stripeHandler } from '../../webhooks/stripeHandler';

/**
 * Providers' own account of what happened, delivered rather than asked for.
 *
 * Deliberately unauthenticated in the usual sense: a provider has no session and
 * no API key of ours. The signature *is* the authentication, and it is the only
 * thing standing between this route and an attacker marking arbitrary payments
 * as approved — so an unverified request is refused before anything else looks
 * at the body.
 *
 * Mounted with a raw body parser ahead of the global JSON one, because
 * verification hashes the exact bytes the provider sent. Any reserialisation,
 * however faithful it looks, changes them and the signature stops matching.
 */

const router = Router();

registerHandler(stripeHandler);

router.post('/:provider', async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const handler = getHandler(provider);
  if (!handler) return res.status(404).json({ error: 'Unknown provider' });

  const adapter = db.getAdapter();
  const settings = await adapter.getSettings();

  if (!handler.isConfigured(settings)) {
    // Accepting unverified events because we have no secret configured would be
    // strictly worse than not listening at all.
    logger.error(`Webhook for ${provider} received but no signing secret is configured`);
    return res.status(503).json({ error: 'Webhooks are not configured' });
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody) || !handler.verify(rawBody, req.headers, settings)) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let event: InboundEvent;
  try {
    event = handler.parse(rawBody);
  } catch (error) {
    logger.warn(
      `Unreadable ${provider} webhook body: ${error instanceof Error ? error.message : 'parse error'}`
    );
    return res.status(400).json({ error: 'Unreadable body' });
  }

  /**
   * Claim the event before doing anything with it.
   *
   * The insert is the deduplication: a redelivery collides on the primary key
   * and we stop. Done as a write rather than a read-then-write because two
   * deliveries can arrive at the same instant, and a check that is separate
   * from the claim lets both pass it.
   */
  const claimed = await adapter.claimWebhookEvent({
    id: event.id,
    type: event.type,
    chargeId: event.chargeId,
  });
  if (!claimed) {
    logger.info(`Ignoring duplicate ${provider} event ${event.id}`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    await handler.handle(event);
    await adapter.markWebhookEventHandled(event.id);
  } catch (error) {
    // The event is already claimed, so it will not be retried into this handler
    // by a redelivery. Recording why it failed is what makes it findable.
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to handle ${provider} event ${event.id}: ${message}`);
    await adapter.markWebhookEventHandled(event.id, message).catch(() => undefined);
  }

  // Always 200 once the signature checked out. A non-2xx tells the provider to
  // retry, and retrying an event we have already claimed cannot achieve anything.
  return res.status(200).json({ received: true });
});

export default router;
