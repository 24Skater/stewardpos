import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Refunding a card sale from the returns desk.
 *
 * Until now this route wrote a `refund_transactions` row saying `completed` and
 * called no processor at all, so a customer was told they had been refunded
 * while the money never moved. These tests pin the opposite: the row is only
 * written once Stripe has accepted the refund, and it records what Stripe said.
 */

const getUserByEmail = vi.fn();
const getReturnById = vi.fn();
const getOrderById = vi.fn();
const createRefundTransaction = vi.fn();
const updateReturnRefundStatus = vi.fn();
const createStoreCredit = vi.fn();
const createAuditLog = vi.fn();
const getSettings = vi.fn();

const refundCharge = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getReturnById,
      getOrderById,
      createRefundTransaction,
      updateReturnRefundStatus,
      createStoreCredit,
      createAuditLog,
      getSettings,
    }),
  },
}));

vi.mock('../../../terminal/TerminalAdapterFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../terminal/TerminalAdapterFactory')>();
  return {
    ...actual,
    createTerminalAdapter: () => ({ refundCharge }),
  };
});

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'staff@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function aReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ret-1',
    originalOrderId: 'o1',
    status: 'approved',
    refundStatus: 'pending',
    total: 25,
    items: [],
    ...overrides,
  };
}

function refundRequest(body: Record<string, unknown>) {
  return request(app)
    .post('/api/returns/ret-1/process-refund')
    .set('Authorization', `Bearer ${token()}`)
    .send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'staff@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getReturnById.mockResolvedValue(aReturn());
  getOrderById.mockResolvedValue({ id: 'o1', cardTransactionId: 'pi_123' });
  getSettings.mockResolvedValue({
    config: { paymentMethods: { card: { provider: 'stripe' } }, terminalCredentials: {} },
  });
  createRefundTransaction.mockResolvedValue({ id: 'rt-1' });
  updateReturnRefundStatus.mockResolvedValue({});
  createStoreCredit.mockResolvedValue({});
  createAuditLog.mockResolvedValue({});
  refundCharge.mockResolvedValue({ refundId: 're_1', status: 'succeeded', amount: 2500 });
});

describe('POST /api/returns/:id/process-refund — card', () => {
  it('sends the refund to the processor before recording it', async () => {
    const response = await refundRequest({ refundMethod: 'card' });

    expect(response.status).toBe(200);
    expect(refundCharge).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: 'pi_123' })
    );
    expect(createRefundTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        processorTransactionId: 're_1',
        status: 'succeeded',
      })
    );
  });

  it('converts the refund amount to minor units', async () => {
    // The route works in dollars and the processor bills in cents; getting this
    // wrong refunds a hundredth or a hundred times what was intended.
    await refundRequest({ refundMethod: 'card', amount: 10.5 });

    expect(refundCharge).toHaveBeenCalledWith(expect.objectContaining({ amount: 1050 }));
  });

  it('omits the amount entirely on a full refund', async () => {
    await refundRequest({ refundMethod: 'card' });

    expect(refundCharge.mock.calls[0][0].amount).toBeUndefined();
  });

  it('uses a stable idempotency key so a double-click cannot pay out twice', async () => {
    await refundRequest({ refundMethod: 'card' });
    await refundRequest({ refundMethod: 'card' });

    const [first, second] = refundCharge.mock.calls;
    expect(first[0].idempotencyKey).toBeTruthy();
    expect(first[0].idempotencyKey).toBe(second[0].idempotencyKey);
  });

  it('records nothing when the processor rejects the refund', async () => {
    // The old code would have written `completed` regardless. Recording a
    // refund that did not happen is worse than failing loudly.
    refundCharge.mockRejectedValue(new Error('No such payment_intent: pi_123'));

    const response = await refundRequest({ refundMethod: 'card' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(createRefundTransaction).not.toHaveBeenCalled();
    expect(updateReturnRefundStatus).not.toHaveBeenCalled();
  });

  it('records a failed refund as failed, with the reason', async () => {
    refundCharge.mockResolvedValue({
      refundId: 're_2',
      status: 'failed',
      amount: 2500,
      failureReason: 'expired_or_canceled_card',
    });

    const response = await refundRequest({ refundMethod: 'card' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(createRefundTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureReason: 'expired_or_canceled_card' })
    );
    // The return stays refundable so somebody can resolve it another way.
    expect(updateReturnRefundStatus).not.toHaveBeenCalled();
  });

  it('refuses when the original sale was never paid by card', async () => {
    getOrderById.mockResolvedValue({ id: 'o1', cardTransactionId: null });

    const response = await refundRequest({ refundMethod: 'card' });

    expect(response.status).toBe(400);
    expect(refundCharge).not.toHaveBeenCalled();
    expect(createRefundTransaction).not.toHaveBeenCalled();
  });

  it('treats original_payment on a card sale as a card refund', async () => {
    await refundRequest({ refundMethod: 'original_payment' });

    expect(refundCharge).toHaveBeenCalled();
  });
});

describe('POST /api/returns/:id/process-refund — other tenders', () => {
  it('leaves cash refunds alone', async () => {
    const response = await refundRequest({ refundMethod: 'cash' });

    expect(response.status).toBe(200);
    expect(refundCharge).not.toHaveBeenCalled();
    expect(createRefundTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('still mints a store credit without touching the processor', async () => {
    const response = await refundRequest({ refundMethod: 'store_credit' });

    expect(response.status).toBe(200);
    expect(refundCharge).not.toHaveBeenCalled();
    expect(createStoreCredit).toHaveBeenCalled();
  });
});
