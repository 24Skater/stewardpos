import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

/**
 * The webhook endpoint.
 *
 * Two properties matter more than the rest and are the reason this file exists.
 *
 * The signature is the only authentication this route has — Stripe holds no
 * session and no key of ours — so an unsigned or wrongly-signed request must
 * not reach the handler. Without that, anyone who knows the URL can mark
 * arbitrary payments as approved.
 *
 * And verification hashes the exact bytes Stripe sent, which is why the route
 * is mounted with a raw body parser ahead of the global JSON one. That ordering
 * is easy to break by moving a line in `app.ts` and it fails closed but
 * silently — every event rejected, nothing obviously wrong — so it is pinned
 * here by signing a real payload and sending it through the real app.
 */

const SECRET = 'whsec_test_secret';

const getSettings = vi.fn();
const claimWebhookEvent = vi.fn();
const markWebhookEventHandled = vi.fn();
const getPaymentAttemptByChargeId = vi.fn();
const updatePaymentAttempt = vi.fn();
const markRefundFailed = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getSettings,
      claimWebhookEvent,
      markWebhookEventHandled,
      getPaymentAttemptByChargeId,
      updatePaymentAttempt,
      markRefundFailed,
    }),
  },
}));

const { default: app } = await import('../../../app');

/** Sign a payload the way Stripe does, so the real verifier accepts it. */
function signed(payload: unknown, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return { body, header: `t=${timestamp},v1=${signature}` };
}

function post(payload: unknown, options: { secret?: string; header?: string } = {}) {
  const { body, header } = signed(payload, options.secret ?? SECRET);
  const req = request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json');
  if (options.header !== undefined) {
    if (options.header) req.set('stripe-signature', options.header);
  } else {
    req.set('stripe-signature', header);
  }
  return req.send(body);
}

function event(type: string, object: Record<string, unknown>, id = 'evt_1') {
  return { id, object: 'event', type, data: { object } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({
    config: { terminalCredentials: { stripeWebhookSecret: SECRET } },
  });
  claimWebhookEvent.mockResolvedValue(true);
  markWebhookEventHandled.mockResolvedValue(undefined);
  getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'pending' });
  updatePaymentAttempt.mockResolvedValue({});
  markRefundFailed.mockResolvedValue(undefined);
});

describe('signature verification', () => {
  it('accepts a correctly signed event', async () => {
    // Proves the raw-body mount as much as the verifier: if `express.json()`
    // reached this route first, the bytes would differ and this would 400.
    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }));

    expect(response.status).toBe(200);
    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', { status: 'authorized' });
  });

  it('rejects an event signed with the wrong secret', async () => {
    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }), {
      secret: 'whsec_not_ours',
    });

    expect(response.status).toBe(400);
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('rejects an event with no signature at all', async () => {
    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }), { header: '' });

    expect(response.status).toBe(400);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('refuses to listen when no signing secret is configured', async () => {
    // Accepting unverified events because we have nothing to verify against
    // would be strictly worse than not listening.
    getSettings.mockResolvedValue({ config: {} });

    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }));

    expect(response.status).toBe(503);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });
});

describe('deduplication', () => {
  it('does the work once and acknowledges the redelivery', async () => {
    claimWebhookEvent.mockResolvedValue(false);

    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }));

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(true);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('claims the event before acting on it', async () => {
    await post(event('payment_intent.succeeded', { id: 'pi_1' }));

    expect(claimWebhookEvent.mock.invocationCallOrder[0]).toBeLessThan(
      updatePaymentAttempt.mock.invocationCallOrder[0]
    );
  });
});

describe('outcomes', () => {
  it('settles a reader action that succeeded', async () => {
    const response = await post(
      event('terminal.reader.action_succeeded', {
        id: 'tmr_1',
        action: { type: 'process_payment_intent', process_payment_intent: { payment_intent: 'pi_9' } },
      })
    );

    expect(response.status).toBe(200);
    expect(getPaymentAttemptByChargeId).toHaveBeenCalledWith('pi_9');
    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', { status: 'authorized' });
  });

  it('carries the decline reason off a failed reader action', async () => {
    await post(
      event('terminal.reader.action_failed', {
        id: 'tmr_1',
        action: {
          type: 'process_payment_intent',
          failure_code: 'card_declined',
          process_payment_intent: { payment_intent: 'pi_9' },
        },
      })
    );

    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', {
      status: 'failed',
      failureReason: 'card_declined',
    });
  });

  it('prefers the issuer decline code on a failed payment intent', async () => {
    await post(
      event('payment_intent.payment_failed', {
        id: 'pi_1',
        last_payment_error: { code: 'card_declined', decline_code: 'lost_card' },
      })
    );

    expect(updatePaymentAttempt).toHaveBeenCalledWith('att-1', {
      status: 'failed',
      failureReason: 'lost_card',
    });
  });

  it('marks a refund that Stripe later reversed', async () => {
    // The gap left open by the refunds work: a refund can be accepted and then
    // fail, and until this arrives our records claim a customer was repaid.
    const response = await post(
      event('refund.failed', {
        id: 're_1',
        payment_intent: 'pi_1',
        failure_reason: 'expired_or_canceled_card',
      })
    );

    expect(response.status).toBe(200);
    expect(markRefundFailed).toHaveBeenCalledWith('re_1', 'expired_or_canceled_card');
  });

  it('acknowledges an event type it does not act on', async () => {
    // Stripe retries anything non-2xx, so an unhandled type must still be 200
    // or it is redelivered for three days.
    const response = await post(event('customer.created', { id: 'cus_1' }));

    expect(response.status).toBe(200);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
    expect(markWebhookEventHandled).toHaveBeenCalledWith('evt_1');
  });

  it('still answers 200 when the handler itself fails', async () => {
    // The event is already claimed, so a retry cannot achieve anything. Failing
    // loudly to Stripe would just buy three days of redeliveries.
    updatePaymentAttempt.mockRejectedValue(new Error('database is on fire'));

    const response = await post(event('payment_intent.succeeded', { id: 'pi_1' }));

    expect(response.status).toBe(200);
    expect(markWebhookEventHandled).toHaveBeenCalledWith('evt_1', 'database is on fire');
  });
});
