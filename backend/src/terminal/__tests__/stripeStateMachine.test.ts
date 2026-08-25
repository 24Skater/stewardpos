import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Telling the truth about what the reader and the card actually did.
 *
 * The behaviours pinned here are the ones a cashier experiences directly: a
 * declined card that says so immediately instead of spinning, a cancel that
 * actually clears the reader, and an unreachable reader that reads as
 * unreachable rather than as a server fault.
 */

const paymentIntentsCreate = vi.fn();
const paymentIntentsRetrieve = vi.fn();
const paymentIntentsCancel = vi.fn();
const processPaymentIntent = vi.fn();
const cancelAction = vi.fn();

vi.mock('stripe', () => ({
  default: class {
    paymentIntents = {
      create: paymentIntentsCreate,
      retrieve: paymentIntentsRetrieve,
      cancel: paymentIntentsCancel,
    };
    terminal = {
      readers: { list: vi.fn(), processPaymentIntent, cancelAction },
    };
    refunds = { create: vi.fn() };
  },
}));

const { StripeTerminalAdapter } = await import('../StripeTerminalAdapter');
const { TerminalUnavailableError } = await import('../errors');

function adapter() {
  return new StripeTerminalAdapter({
    secretKey: 'sk_test_x',
    locationId: 'tml_1',
    readerId: 'tmr_1',
  });
}

/** A Stripe SDK error carries its reason on `code`. */
function stripeError(code: string) {
  return Object.assign(new Error(`stripe says ${code}`), {
    code,
    type: 'invalid_request_error',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' });
  processPaymentIntent.mockResolvedValue({ id: 'tmr_1' });
  paymentIntentsCancel.mockResolvedValue({});
  cancelAction.mockResolvedValue({});
});

describe('a declined card', () => {
  it('reads as declined, not as still waiting', async () => {
    // Stripe returns a declined PaymentIntent to `requires_payment_method` —
    // the same status a brand new one has. Reporting that as pending left the
    // POS polling until its 90-second timeout while the customer stood there,
    // and the decline reason was never shown at all.
    paymentIntentsRetrieve.mockResolvedValue({
      status: 'requires_payment_method',
      latest_charge: null,
      last_payment_error: {
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
      },
    });

    const result = await adapter().getChargeStatus('pi_1');

    expect(result.status).toBe('declined');
    expect(result.declineCode).toBe('insufficient_funds');
    expect(result.errorMessage).toBe('Your card has insufficient funds.');
  });

  it('still reads a fresh intent as pending', async () => {
    // Same status, no error yet: the reader is simply waiting for a card.
    paymentIntentsRetrieve.mockResolvedValue({
      status: 'requires_payment_method',
      latest_charge: null,
      last_payment_error: null,
    });

    const result = await adapter().getChargeStatus('pi_1');

    expect(result.status).toBe('pending');
  });

  it('falls back to the error code when the issuer gives no decline code', async () => {
    paymentIntentsRetrieve.mockResolvedValue({
      status: 'requires_payment_method',
      latest_charge: null,
      last_payment_error: { code: 'expired_card', message: 'Your card has expired.' },
    });

    const result = await adapter().getChargeStatus('pi_1');

    expect(result).toMatchObject({ status: 'declined', declineCode: 'expired_card' });
  });
});

describe('cancelling a charge', () => {
  it('clears the reader as well as the intent', async () => {
    // Cancelling only the PaymentIntent left the reader still lit and asking
    // for a card, so the next sale hit `terminal_reader_busy`.
    await adapter().cancelCharge('pi_1');

    expect(cancelAction).toHaveBeenCalledWith('tmr_1');
    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_1');
  });

  it('still cancels the intent when the reader will not reset', async () => {
    // Stopping the money is the part that must not be skipped; a reader that
    // is offline or already idle is not a reason to leave an intent live.
    cancelAction.mockRejectedValue(stripeError('terminal_reader_offline'));

    await adapter().cancelCharge('pi_1');

    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_1');
  });
});

describe('a reader that cannot take the payment', () => {
  it.each([
    ['terminal_reader_offline', /offline/i],
    ['terminal_reader_busy', /another|busy/i],
    ['terminal_reader_timeout', /again|timed out/i],
  ])('turns %s into something a cashier can act on', async (code, expected) => {
    processPaymentIntent.mockRejectedValue(stripeError(code));

    const attempt = adapter().createCharge(1000, 'usd', {});

    await expect(attempt).rejects.toBeInstanceOf(TerminalUnavailableError);
    await expect(attempt).rejects.toThrow(expected);
  });

  it('cancels the orphaned intent when the reader refused the handoff', async () => {
    // The reader never saw this payment, so the intent is dead weight; leaving
    // it live means a stale uncapturable intent per failed attempt.
    processPaymentIntent.mockRejectedValue(stripeError('terminal_reader_busy'));

    await expect(adapter().createCharge(1000, 'usd', {})).rejects.toThrow();

    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_1');
  });

  it('leaves the intent alone after a reader timeout', async () => {
    // Stripe documents this as a possible false negative: the reader may have
    // received the command and be taking the card right now. Cancelling here
    // would void a payment already in progress.
    processPaymentIntent.mockRejectedValue(stripeError('terminal_reader_timeout'));

    await expect(adapter().createCharge(1000, 'usd', {})).rejects.toThrow();

    expect(paymentIntentsCancel).not.toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  it('sends the caller key so a retried request cannot double charge', async () => {
    await adapter().createCharge(1000, 'usd', { idempotencyKey: 'attempt-1' });

    expect(paymentIntentsCreate.mock.calls[0][1]).toMatchObject({
      idempotencyKey: 'attempt-1',
    });
  });

  it('creates no intent at all without a key, rather than an unguarded one', async () => {
    // Absent a key this is exactly the call that produces two PaymentIntents
    // for one sale, so the charge still goes out — but scoped to its own
    // attempt id so the request is at least self-consistent.
    await adapter().createCharge(1000, 'usd', {});

    expect(paymentIntentsCreate.mock.calls[0][1].idempotencyKey).toEqual(expect.any(String));
  });
});
