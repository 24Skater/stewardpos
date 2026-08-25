import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * The list of money taken that never became a sale, and what can be done to it.
 *
 * This is the surface that makes the payment-attempt record worth having: a
 * charge with no order behind it is only useful if somebody can see it and act.
 * What is pinned here is mostly what the route *refuses* to do — the wrong
 * repair on a payments screen is worse than no repair.
 */

const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const listUnreconciledAttempts = vi.fn();
const getPaymentAttemptById = vi.fn();
const getPaymentAttemptByChargeId = vi.fn();
const updatePaymentAttempt = vi.fn();
const createAuditLog = vi.fn();

const refundCharge = vi.fn();
const getChargeStatus = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getSettings,
      listUnreconciledAttempts,
      getPaymentAttemptById,
      getPaymentAttemptByChargeId,
      updatePaymentAttempt,
      createAuditLog,
    }),
  },
}));

vi.mock('../../../terminal/TerminalAdapterFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../terminal/TerminalAdapterFactory')>();
  return { ...actual, createTerminalAdapter: () => ({ refundCharge, getChargeStatus }) };
});

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function stranded(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chargeId: 'pi_stranded',
    amountCents: 2500,
    currency: 'USD',
    status: 'authorized',
    orderId: null,
    cartSnapshot: { items: [] },
    createdAt: Date.now() - 600_000,
    ...overrides,
  };
}

const ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getSettings.mockResolvedValue({
    config: { paymentMethods: { card: { provider: 'stripe' } }, terminalCredentials: {} },
  });
  listUnreconciledAttempts.mockResolvedValue([stranded()]);
  getPaymentAttemptById.mockResolvedValue(stranded());
  getPaymentAttemptByChargeId.mockResolvedValue(stranded());
  updatePaymentAttempt.mockResolvedValue({});
  createAuditLog.mockResolvedValue({});
  refundCharge.mockResolvedValue({ refundId: 're_1', status: 'succeeded', amount: 2500 });
  getChargeStatus.mockResolvedValue({ chargeId: 'pi_stranded', status: 'approved' });
});

const auth = () => ({ Authorization: `Bearer ${token()}` });

describe('GET /api/admin/reconciliation', () => {
  it('lists charges with no sale behind them', async () => {
    const response = await request(app).get('/api/admin/reconciliation').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('leaves sales still in progress out of it', async () => {
    // A cashier mid-transaction is not an incident, and a list full of them is
    // one nobody reads.
    await request(app).get('/api/admin/reconciliation').set(auth());

    expect(listUnreconciledAttempts).toHaveBeenCalledWith(
      expect.objectContaining({ olderThanMs: 5 * 60 * 1000 })
    );
  });

  it('lets the window be narrowed for looking at recent activity', async () => {
    await request(app).get('/api/admin/reconciliation?withinMinutes=1').set(auth());

    expect(listUnreconciledAttempts).toHaveBeenCalledWith(
      expect.objectContaining({ olderThanMs: 60_000 })
    );
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/admin/reconciliation')).status).toBe(401);
  });
});

describe('POST /:id/recheck', () => {
  it('asks the processor and settles the attempt through the shared handler', async () => {
    // Going through `recordChargeOutcome` is what stops a manual re-check
    // reaching a different conclusion than a webhook would have.
    const response = await request(app).post(`/api/admin/reconciliation/${ID}/recheck`).set(auth());

    expect(response.status).toBe(200);
    expect(getChargeStatus).toHaveBeenCalledWith('pi_stranded');
    expect(updatePaymentAttempt).toHaveBeenCalledWith(ID, { status: 'authorized' });
  });

  it('has nothing to check when the charge never reached the processor', async () => {
    getPaymentAttemptById.mockResolvedValue(stranded({ chargeId: null }));

    const response = await request(app).post(`/api/admin/reconciliation/${ID}/recheck`).set(auth());

    expect(response.status).toBe(422);
    expect(getChargeStatus).not.toHaveBeenCalled();
  });
});

describe('POST /:id/refund', () => {
  it('refunds the whole charge and records why the attempt ended', async () => {
    const response = await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());

    expect(response.status).toBe(200);
    // No amount: this repairs a mistake rather than settling a negotiated
    // return, so a partial would leave a remainder belonging to nothing.
    expect(refundCharge.mock.calls[0][0].amount).toBeUndefined();
    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('uses a key stable per attempt so a double-click cannot refund twice', async () => {
    await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());
    await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());

    expect(refundCharge.mock.calls[0][0].idempotencyKey).toBe(
      refundCharge.mock.calls[1][0].idempotencyKey
    );
  });

  it('refuses to refund a payment that belongs to a sale', async () => {
    // That is a return, with goods to account for, and it belongs in Returns.
    getPaymentAttemptById.mockResolvedValue(stranded({ orderId: 'o1' }));

    const response = await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());

    expect(response.status).toBe(422);
    expect(refundCharge).not.toHaveBeenCalled();
  });

  it('does not mark the attempt settled when the refund is declined', async () => {
    refundCharge.mockResolvedValue({ refundId: 're_2', status: 'failed', amount: 2500, failureReason: 'expired_or_canceled_card' });

    const response = await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());

    expect(response.status).toBe(422);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('records who gave the money back', async () => {
    await request(app).post(`/api/admin/reconciliation/${ID}/refund`).set(auth());

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund', entity: 'payment_attempt' })
    );
  });
});

describe('POST /:id/dismiss', () => {
  it('needs a reason', async () => {
    // A dismissal with no explanation is indistinguishable from someone
    // clearing a list they did not read.
    const response = await request(app)
      .post(`/api/admin/reconciliation/${ID}/dismiss`)
      .set(auth())
      .send({});

    expect(response.status).toBe(400);
    expect(updatePaymentAttempt).not.toHaveBeenCalled();
  });

  it('keeps the reason on the attempt', async () => {
    const response = await request(app)
      .post(`/api/admin/reconciliation/${ID}/dismiss`)
      .set(auth())
      .send({ reason: 'Rung again on lane 2' });

    expect(response.status).toBe(200);
    expect(updatePaymentAttempt).toHaveBeenCalledWith(ID, {
      status: 'cancelled',
      failureReason: 'Dismissed: Rung again on lane 2',
    });
  });
});
