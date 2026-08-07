import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Resending a receipt used to record `status: 'sent'` and reply "Receipt sent
 * to …" without anything being sent. These cover the thing that made that bad:
 * the history is what someone reads to find out whether a customer was emailed,
 * so it has to be true.
 */
const getUserByEmail = vi.fn();
const getOrderById = vi.fn();
const logReceiptEmail = vi.fn();
const sendEmail = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, getOrderById, logReceiptEmail }) },
}));
vi.mock('../../../services/email', () => ({ sendEmail }));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const ORDER = {
  id: 'ord-12345678',
  createdAt: Date.now(),
  items: [{ quantity: 2, nameSnapshot: 'Tea', size: 'Large', lineTotal: 10 }],
  subtotal: 10,
  discountTotal: 0,
  taxTotal: 0.8,
  total: 10.8,
  paymentMethod: 'Cash',
};

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const auth = () => ({ Authorization: `Bearer ${token()}` });
const resend = () =>
  request(app).post('/api/receipts/ord-12345678/resend').set(auth()).send({ email: 'buyer@example.com' });

/** What was written to the resend history. */
const logged = () => logReceiptEmail.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getOrderById.mockResolvedValue(ORDER);
  logReceiptEmail.mockResolvedValue({});
  sendEmail.mockResolvedValue({ status: 'sent', detail: 'Delivered to the SMTP server' });
});

describe('POST /api/receipts/:id/resend', () => {
  it('actually sends, and says so', async () => {
    const response = await resend();

    expect(response.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com', subject: 'Receipt #ORD-1234' })
    );
    expect(logged().status).toBe('sent');
  });

  it('puts the totals in the message body', async () => {
    await resend();

    const { text } = sendEmail.mock.calls[0][0];
    // `nameSnapshot` is the name as sold, so a later rename cannot rewrite a
    // receipt already issued.
    expect(text).toContain('2 x Tea (Large)  $10.00');
    expect(text).toContain('Total     $10.80');
  });

  it('leaves out a discount line when there was no discount', async () => {
    // "Discount $0.00" invites the question of which discount, and there
    // wasn't one.
    await resend();

    expect(sendEmail.mock.calls[0][0].text).not.toContain('Discount');
  });

  it('reports a log-only send honestly rather than claiming delivery', async () => {
    // `console` is the default adapter. Calling a log entry a delivery is the
    // bug this replaces.
    sendEmail.mockResolvedValue({ status: 'logged', detail: 'no adapter' });

    const response = await resend();

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/No email adapter is configured/);
    expect(response.body.data.status).toBe('logged');
  });

  it('records a log-only send as exactly that, not as sent or failed', async () => {
    // Recording it as `failed` shows a bounce that never happened to someone
    // reading the history to find out whether their customer got the receipt.
    sendEmail.mockResolvedValue({ status: 'logged', detail: 'no adapter' });

    await resend();

    expect(logged().status).toBe('logged');
  });

  it('fails loudly when the mail server refuses it', async () => {
    sendEmail.mockResolvedValue({ status: 'failed', detail: 'mailbox full' });

    const response = await resend();

    // 502, not 500: the request was fine and the server is fine, the mail
    // service is not.
    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/mailbox full/);
  });

  it('records a failure, because that is what the history is read for', async () => {
    sendEmail.mockResolvedValue({ status: 'failed', detail: 'mailbox full' });

    await resend();

    expect(logReceiptEmail).toHaveBeenCalled();
    expect(logged().status).toBe('failed');
  });

  it('404s for an order that does not exist, without sending anything', async () => {
    getOrderById.mockResolvedValue(null);

    expect((await resend()).status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed address before sending', async () => {
    const response = await request(app)
      .post('/api/receipts/ord-12345678/resend')
      .set(auth())
      .send({ email: 'not-an-address' });

    expect(response.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
