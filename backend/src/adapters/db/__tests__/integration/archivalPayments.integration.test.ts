import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Archival, receipt email history, and terminal transaction SQL.
 *
 * Archiving is a transaction that copies a customer into `archived_customers`
 * and removes the original — so a partial failure either loses the customer or
 * duplicates them. Terminal transactions are the record that a card was
 * charged, linked to an order after the fact by charge id, which is the only
 * thread tying a payment back to a sale.
 */
let h: Harness;
const mark = tag();

const customerIds: string[] = [];

/**
 * `archived_customers.archived_by` is a foreign key to `users`, so it needs a
 * real account — not a UUID-shaped string. Created below.
 */
let ACTOR: string;
const orderIds: string[] = [];
const chargeIds: string[] = [];

async function makeCustomer() {
  const created = await h.adapter.createCustomer({
    name: `${mark} Buyer ${customerIds.length}`,
    email: `${mark}-${customerIds.length}@example.com`,
    phone: '555-0100',
    notes: `${mark} note`,
  });
  customerIds.push(String(created.id));
  return created;
}

beforeAll(async () => {
  h = await connect();
  const actor = await h.adapter.createUser({
    email: `${mark}-archivist@example.com`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} archivist`,
    status: 'active',
    roleIds: [],
  });
  ACTOR = String(actor.id);
}, 30_000);

afterAll(async () => {
  if (orderIds.length > 0) {
    await h.query('DELETE FROM receipt_emails WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM payments WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM order_items WHERE order_id = ANY($1)', [orderIds]);
    await h.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  }
  if (chargeIds.length > 0) {
    await h.query('DELETE FROM terminal_transactions WHERE charge_id = ANY($1)', [chargeIds]);
  }
  if (customerIds.length > 0) {
    await h.query('DELETE FROM archived_customers WHERE id = ANY($1)', [customerIds]);
    await h.query('DELETE FROM customers WHERE id = ANY($1)', [customerIds]);
  }
  if (ACTOR) {
    await h.query('DELETE FROM users WHERE id = $1', [ACTOR]);
  }
  await h.close();
});

describe('archiving a customer', () => {
  it('moves them out of the live table', async () => {
    const customer = await makeCustomer();

    expect(await h.adapter.archiveCustomer(String(customer.id), ACTOR)).toBe(true);
    expect(await h.adapter.getCustomerById(String(customer.id))).toBeNull();
  });

  it('keeps their details, which is the point of archiving over deleting', async () => {
    const customer = await makeCustomer();

    await h.adapter.archiveCustomer(String(customer.id), ACTOR);

    const { rows } = await h.query('SELECT * FROM archived_customers WHERE id = $1', [customer.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: customer.name, email: customer.email });
  });

  it('records who archived them and why', async () => {
    const customer = await makeCustomer();

    await h.adapter.archiveCustomer(String(customer.id), ACTOR, 'moved away');

    const { rows } = await h.query(
      'SELECT archived_by, archive_reason FROM archived_customers WHERE id = $1',
      [customer.id]
    );
    expect(rows[0]).toMatchObject({ archived_by: ACTOR, archive_reason: 'moved away' });
  });

  it('preserves the original created_at rather than stamping now', async () => {
    // The archive is a record of a relationship; rewriting when it started
    // would misrepresent how long they had been a customer.
    const customer = await makeCustomer();
    const { rows: before } = await h.query('SELECT created_at FROM customers WHERE id = $1', [
      customer.id,
    ]);

    await h.adapter.archiveCustomer(String(customer.id), ACTOR);

    const { rows: after } = await h.query(
      'SELECT created_at FROM archived_customers WHERE id = $1',
      [customer.id]
    );
    expect(new Date(String(after[0].created_at)).getTime()).toBe(
      new Date(String(before[0].created_at)).getTime()
    );
  });

  it('carries their quotes into the archive, with the tax and expiry intact', async () => {
    // The archive read `quote.tax` and `quote.valid_until`; the columns are
    // `tax_total` and `expires_at`. `SELECT *` yields undefined for the wrong
    // names, which reaches Postgres as NULL — so the archive was blanking the
    // two fields it exists to preserve.
    const customer = await makeCustomer();
    const expires = new Date(Date.now() + 86_400_000);
    const quote = await h.adapter.createQuote({
      customerId: customer.id,
      status: 'sent',
      subtotal: 80,
      taxTotal: 6.4,
      total: 86.4,
      expiresAt: expires.toISOString(),
      items: [{ description: `${mark} work`, quantity: 1, unitPrice: 80, lineTotal: 80 }],
    });

    await h.adapter.archiveCustomer(String(customer.id), ACTOR);

    const { rows } = await h.query('SELECT * FROM archived_quotes WHERE id = $1', [quote.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tax)).toBe(6.4);
    // To the second: the source column stores whole seconds, so the archived
    // expiry differs by sub-second precision. Immaterial for a quote, which
    // expires on a day, but worth asserting deliberately rather than rounding
    // silently and calling it equal.
    expect(Math.floor(new Date(String(rows[0].valid_until)).getTime() / 1000)).toBe(
      Math.floor(expires.getTime() / 1000)
    );
    await h.query('DELETE FROM archived_quotes WHERE id = $1', [quote.id]);
  });

  it('folds the quote’s line items into the archive, so they survive the delete', async () => {
    const customer = await makeCustomer();
    const quote = await h.adapter.createQuote({
      customerId: customer.id,
      status: 'draft',
      subtotal: 40,
      taxTotal: 0,
      total: 40,
      items: [{ description: `${mark} bench hour`, quantity: 2, unitPrice: 20, lineTotal: 40 }],
    });

    await h.adapter.archiveCustomer(String(customer.id), ACTOR);

    const { rows } = await h.query('SELECT items FROM archived_quotes WHERE id = $1', [quote.id]);
    const items = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : rows[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe(`${mark} bench hour`);
    await h.query('DELETE FROM archived_quotes WHERE id = $1', [quote.id]);
  });

  it('leaves the sales ledger alone', async () => {
    // Orders are what returns and reporting read. A customer asking to be
    // archived is not a reason to erase the shop's record of what it sold —
    // and the previous version deleted them, when it got that far at all.
    const customer = await makeCustomer();
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 10,
      discountTotal: 0,
      taxTotal: 0,
      total: 10,
      paymentMethod: 'Cash',
      customerEmail: String(customer.email),
      payments: [{ method: 'cash', amount: 10 }],
    });
    orderIds.push(String(order.id));

    await h.adapter.archiveCustomer(String(customer.id), ACTOR);

    expect(await h.adapter.getOrderById(String(order.id))).toBeTruthy();
  });

  it('reports false for a customer who does not exist, without archiving anything', async () => {
    const { rows: before } = await h.query('SELECT COUNT(*)::int AS count FROM archived_customers');

    expect(await h.adapter.archiveCustomer('00000000-0000-0000-0000-0000000000ff', ACTOR)).toBe(false);

    const { rows: after } = await h.query('SELECT COUNT(*)::int AS count FROM archived_customers');
    expect(after[0].count).toBe(before[0].count);
  });
});

describe('receipt email history', () => {
  it('records a send and reads it back for the order', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 10,
      discountTotal: 0,
      taxTotal: 0,
      total: 10,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 10 }],
    });
    orderIds.push(String(order.id));

    await h.adapter.logReceiptEmail({
      orderId: order.id,
      recipientEmail: `${mark}@example.com`,
      subject: 'Receipt',
      receiptType: 'sale',
      status: 'sent',
    });

    const history = await h.adapter.getReceiptEmailHistory(String(order.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ recipientEmail: `${mark}@example.com`, status: 'sent' });
  });

  it('records a failure too, since that is what the history is read for', async () => {
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });
    orderIds.push(String(order.id));

    await h.adapter.logReceiptEmail({
      orderId: order.id,
      recipientEmail: `${mark}-fail@example.com`,
      subject: 'Receipt',
      receiptType: 'sale',
      status: 'failed',
    });

    const history = await h.adapter.getReceiptEmailHistory(String(order.id));
    expect(history[0].status).toBe('failed');
  });

  it('returns nothing for an order that was never emailed', async () => {
    expect(
      await h.adapter.getReceiptEmailHistory('00000000-0000-0000-0000-0000000000ff')
    ).toEqual([]);
  });
});

describe('terminal transactions', () => {
  async function makeTransaction(overrides: Record<string, unknown> = {}) {
    const chargeId = `${mark}-ch-${chargeIds.length}`;
    chargeIds.push(chargeId);
    await h.adapter.createTerminalTransaction({
      startedAt: Date.now(),
      amount: 1250,
      currency: 'USD',
      provider: 'manual',
      chargeId,
      status: 'pending',
      ...overrides,
    } as never);
    return chargeId;
  }

  it('records a charge as it starts', async () => {
    const chargeId = await makeTransaction();

    const { rows } = await h.query('SELECT * FROM terminal_transactions WHERE charge_id = $1', [
      chargeId,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(1250);
    expect(rows[0].status).toBe('pending');
  });

  it('updates by charge id, which is the only thread back to the sale', async () => {
    // The register does not know the row id — it knows the charge id the
    // provider gave it, and links the order afterwards.
    const chargeId = await makeTransaction();

    await h.adapter.updateTerminalTransactionByChargeId(chargeId, {
      status: 'approved',
      authCode: 'A42',
      orderId: null,
    } as never);

    const { rows } = await h.query('SELECT * FROM terminal_transactions WHERE charge_id = $1', [
      chargeId,
    ]);
    expect(rows[0]).toMatchObject({ status: 'approved', auth_code: 'A42' });
  });

  it('updates only the fields it was given', async () => {
    // The update builds its SET clause from what is present, so an approval
    // that mentions no reader must not blank the reader it was taken on.
    const chargeId = await makeTransaction({ readerId: 'reader-1' });

    await h.adapter.updateTerminalTransactionByChargeId(chargeId, { status: 'approved' } as never);

    const { rows } = await h.query('SELECT * FROM terminal_transactions WHERE charge_id = $1', [
      chargeId,
    ]);
    expect(rows[0].reader_id).toBe('reader-1');
  });

  it('does nothing, rather than failing, for a charge id it has never seen', async () => {
    // The register links a transaction after the order commits; a lost update
    // must not fail a sale that already happened.
    await expect(
      h.adapter.updateTerminalTransactionByChargeId(`${mark}-nosuch`, { status: 'approved' } as never)
    ).resolves.not.toThrow();
  });

  it('keeps the amount in the integer cents it was charged in', async () => {
    const chargeId = await makeTransaction({ amount: 99 });

    const { rows } = await h.query('SELECT amount FROM terminal_transactions WHERE charge_id = $1', [
      chargeId,
    ]);
    expect(Number(rows[0].amount)).toBe(99);
  });
});
