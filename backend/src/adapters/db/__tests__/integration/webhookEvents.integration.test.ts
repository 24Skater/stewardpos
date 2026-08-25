import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, type Harness } from './harness';

/**
 * Not acting on the same Stripe event twice.
 *
 * The deduplication is the `ON CONFLICT DO NOTHING` on the insert, so it can
 * only be proved against a real database — a mocked adapter would be asserting
 * that we call a function, not that two simultaneous deliveries cannot both
 * win. That race is the whole reason the claim is a write rather than a read
 * followed by a write.
 */

let h: Harness;

beforeAll(async () => {
  h = await connect();
});

afterAll(async () => {
  await h.close();
});

let counter = 0;
const anEventId = () => `evt_test_${Date.now()}_${counter++}`;

describe('claiming webhook events', () => {
  it('lets the first delivery through', async () => {
    const claimed = await h.adapter.claimWebhookEvent({
      id: anEventId(),
      type: 'payment_intent.succeeded',
      chargeId: 'pi_1',
    });

    expect(claimed).toBe(true);
  });

  it('turns a redelivery away', async () => {
    const id = anEventId();
    const first = await h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' });
    const second = await h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('lets exactly one of two simultaneous deliveries win', async () => {
    // Stripe can deliver the same event twice at once, and this is the case a
    // read-then-write check would get wrong: both reads find nothing, both
    // proceed, and the work happens twice.
    const id = anEventId();

    const results = await Promise.all([
      h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' }),
      h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' }),
      h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('records what the event was about, for tracing a payment later', async () => {
    const id = anEventId();
    await h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded', chargeId: 'pi_trace' });

    const { rows } = await h.query('SELECT type, charge_id, handled_at FROM webhook_events WHERE id = $1', [id]);

    expect(rows[0]).toMatchObject({ type: 'payment_intent.succeeded', charge_id: 'pi_trace' });
    // Unhandled until the handler says so — that is what makes a half-processed
    // event findable rather than indistinguishable from a finished one.
    expect(rows[0].handled_at).toBeNull();
  });

  it('marks an event handled', async () => {
    const id = anEventId();
    await h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' });

    await h.adapter.markWebhookEventHandled(id);

    const { rows } = await h.query('SELECT handled_at, handler_error FROM webhook_events WHERE id = $1', [id]);
    expect(rows[0].handled_at).not.toBeNull();
    expect(rows[0].handler_error).toBeNull();
  });

  it('keeps the reason when handling failed', async () => {
    const id = anEventId();
    await h.adapter.claimWebhookEvent({ id, type: 'payment_intent.succeeded' });

    await h.adapter.markWebhookEventHandled(id, 'database is on fire');

    const { rows } = await h.query('SELECT handler_error FROM webhook_events WHERE id = $1', [id]);
    expect(rows[0].handler_error).toBe('database is on fire');
  });
});

describe('finding an attempt by its charge', () => {
  it('matches the attempt the processor is talking about', async () => {
    const attempt = await h.adapter.createPaymentAttempt({
      amountCents: 1500,
      currency: 'USD',
      provider: 'stripe',
    });
    await h.adapter.updatePaymentAttempt(attempt.id, { chargeId: 'pi_lookup', status: 'pending' });

    const found = await h.adapter.getPaymentAttemptByChargeId('pi_lookup');

    expect(found?.id).toBe(attempt.id);
  });

  it('returns nothing for a charge this till never made', async () => {
    expect(await h.adapter.getPaymentAttemptByChargeId('pi_never_seen')).toBeNull();
  });
});
