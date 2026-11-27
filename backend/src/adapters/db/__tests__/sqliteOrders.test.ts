import { expect, it } from 'vitest';
import { backdate, describeSqlite, MAIN_REGISTER, seedProduct, seedUser, useFreshSqlite } from './sqliteHarness';
import type { SqliteHarness } from './sqliteHarness';

/**
 * Orders, payments, store credit, returns and refunds on SQLite. Mirrors the
 * Postgres orders, orderSearch, money, returns, returnReads, drawerRefunds and
 * archivalPayments integration suites.
 */

function line(productId: string, variantId: string, quantity: number, unitPrice = 5) {
  return {
    productId,
    variantId,
    nameSnapshot: 'Widget',
    quantity,
    unitPrice,
    lineDiscount: 0,
    lineTotal: unitPrice * quantity,
  };
}

async function sell(h: SqliteHarness, extra: Record<string, unknown> = {}) {
  return h.adapter.createOrder({
    items: [],
    subtotal: 10,
    discountTotal: 0,
    taxTotal: 0,
    total: 10,
    paymentMethod: 'Cash',
    ...extra,
  });
}

describeSqlite('createOrder on SQLite', () => {
  const h = useFreshSqlite();

  it('writes the order, its items and its payments together, and decrements stock', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'Widget', 10);

    const order = await h.adapter.createOrder({
      items: [line(productId, variantId, 3)],
      subtotal: 15,
      discountTotal: 0,
      taxTotal: 1.24,
      total: 16.24,
      paymentMethod: 'Split',
      payments: [
        { method: 'cash', amount: 10 },
        { method: 'card', amount: 6.24, reference: 'ch_1' },
      ],
    });

    const read = await h.adapter.getOrderById(String(order.id));
    expect(read).toMatchObject({ total: 16.24, taxTotal: 1.24, paymentMethod: 'Split' });
    expect(read.items).toEqual([expect.objectContaining({ quantity: 3, lineTotal: 15, variantId })]);
    expect(read.payments.map((p: Record<string, unknown>) => [p.method, p.amount, p.reference])).toEqual([
      ['cash', 10, null],
      ['card', 6.24, 'ch_1'],
    ]);
    expect((await h.adapter.getProductById(productId)).variants[0].stock).toBe(7);
  });

  it('refuses an oversell, and rolls the whole order back', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'Widget', 2);

    await expect(
      h.adapter.createOrder({ items: [line(productId, variantId, 3)], subtotal: 15, total: 15, paymentMethod: 'Cash' })
    ).rejects.toThrow('Not enough stock for "Widget"');

    expect(await h.adapter.getAllOrders()).toEqual([]);
    expect((await h.adapter.getProductById(productId)).variants[0].stock).toBe(2);
  });

  it('wraps a non-validation failure as a DatabaseError', async () => {
    // payment_method is NOT NULL.
    await expect(h.adapter.createOrder({ subtotal: 1, total: 1 })).rejects.toThrow('Failed to create order');
  });

  it('keeps an EMV receipt block and cash tendered through a round trip', async () => {
    const receipt = { aid: 'A0000000031010', tvr: '0000008000', cvm: 'PIN' };
    const card = await sell(h, { paymentMethod: 'Card', cardReceipt: receipt, cardAuthCode: 'OK1', cardTransactionId: 'tx' });
    const cash = await sell(h, { amountTendered: 20, changeGiven: 10 });

    expect(await h.adapter.getOrderById(String(card.id))).toMatchObject({
      cardReceipt: receipt,
      cardAuthCode: 'OK1',
      cardTransactionId: 'tx',
    });
    expect(await h.adapter.getOrderById(String(cash.id))).toMatchObject({
      cardReceipt: null,
      amountTendered: 20,
      changeGiven: 10,
    });
  });

  it('names the till and the cashier on a read', async () => {
    const cashier = await seedUser(h.adapter, 'cash@example.com', 'Casey');
    const order = await sell(h, { registerId: MAIN_REGISTER, cashierUserId: cashier });

    expect(await h.adapter.getOrderById(String(order.id))).toMatchObject({
      registerDisplayCode: 'MAIN-01',
      cashierName: 'Casey',
      registerId: MAIN_REGISTER,
    });
    expect(await h.adapter.getOrderById('missing')).toBeNull();
  });

  it('spends store credit inside the order transaction', async () => {
    await h.adapter.createStoreCredit({ code: 'GIFT-1', originalAmount: 10, remainingAmount: 10 });

    const order = await sell(h, {
      total: 10,
      payments: [{ method: 'store_credit', amount: 10, reference: 'gift-1' }],
    });

    expect(await h.adapter.getStoreCreditByCode('GIFT-1')).toMatchObject({
      remainingAmount: 0,
      status: 'used',
      usedOrderId: order.id,
    });
  });

  it('refuses an order paid with more store credit than remains, writing nothing', async () => {
    await h.adapter.createStoreCredit({ code: 'GIFT-2', originalAmount: 5, remainingAmount: 5 });

    await expect(sell(h, { payments: [{ method: 'store_credit', amount: 10, reference: 'GIFT-2' }] })).rejects.toThrow(
      'That store credit is not available'
    );
    expect(await h.adapter.getAllOrders()).toEqual([]);
  });

  it('lists orders newest first with their items, and by customer email', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'Widget', 10);
    const old = await sell(h, { items: [line(productId, variantId, 1)], customerEmail: 'ada@example.com' });
    const recent = await sell(h, { customerEmail: 'ada@example.com' });
    backdate(h.db, 'orders', String(old.id), 1_000);

    const all = await h.adapter.getAllOrders();
    const ada = await h.adapter.getOrdersByCustomerEmail('ada@example.com');

    expect(all.map((o) => o.id)).toEqual([recent.id, old.id]);
    expect((all[1].items as unknown[]).length).toBe(1);
    expect(ada.map((o) => o.id)).toEqual([recent.id, old.id]);
    expect((ada[1].items as unknown[]).length).toBe(1);
  });

  it('finds orders by the phone recorded with the sale', async () => {
    const byPhone = await sell(h, { customerPhone: '2025550100' });
    await sell(h, { customerPhone: '2025550199' });

    const found = await h.adapter.getOrdersByCustomerPhone('2025550100');

    expect(found.map((o) => o.id)).toEqual([byPhone.id]);
  });
});

describeSqlite('searchOrders on SQLite', () => {
  const h = useFreshSqlite();

  it('filters by amount, method, email and date range, and pages', async () => {
    const a = await sell(h, { total: 5, customerEmail: 'a_b@example.com', paymentMethod: 'Cash' });
    const b = await sell(h, { total: 50, customerEmail: 'ab@example.com', paymentMethod: 'Card' });
    const c = await sell(h, { total: 500, paymentMethod: 'Card' });
    backdate(h.db, 'orders', String(a.id), 1_000);
    backdate(h.db, 'orders', String(b.id), 2_000);
    backdate(h.db, 'orders', String(c.id), 3_000);

    const ids = (rows: Record<string, unknown>[]) => rows.map((o) => o.id);

    expect(ids(await h.adapter.searchOrders({ minAmount: 10, maxAmount: 100 }))).toEqual([b.id]);
    expect(ids(await h.adapter.searchOrders({ paymentMethod: 'Card' }))).toEqual([c.id, b.id]);
    expect(ids(await h.adapter.searchOrders({ customerEmail: 'ab@example.com' }))).toEqual([b.id]);
    expect(ids(await h.adapter.searchOrders({ startDate: 1_500, endDate: 2_500 }))).toEqual([b.id]);
    expect(ids(await h.adapter.searchOrders({ limit: 1, offset: 1 }))).toEqual([b.id]);
    // `_` is a literal, not "any one character": only a_b matches.
    expect(ids(await h.adapter.searchOrders({ query: 'a_b' }))).toEqual([a.id]);
    expect((await h.adapter.searchOrders({}))[0]).toHaveProperty('itemCount', 0);
  });
});

describeSqlite('store credit on SQLite', () => {
  const h = useFreshSqlite();

  it('spends part and leaves the rest active, then marks it used once nothing remains', async () => {
    await h.adapter.createStoreCredit({ code: 'SC-1', customerEmail: 'a@example.com', originalAmount: 20, remainingAmount: 20 });

    expect(await h.adapter.redeemStoreCredit('sc-1', 7.5)).toMatchObject({ remainingAmount: 12.5, status: 'active' });
    expect(await h.adapter.redeemStoreCredit('SC-1', 12.5)).toMatchObject({ remainingAmount: 0, status: 'used' });
    expect(await h.adapter.redeemStoreCredit('SC-1', 1)).toBeNull();
  });

  it('refuses more than remains, an expired credit, or an unknown code', async () => {
    await h.adapter.createStoreCredit({ code: 'SC-2', originalAmount: 5, remainingAmount: 5 });
    await h.adapter.createStoreCredit({ code: 'SC-OLD', originalAmount: 5, remainingAmount: 5, expiresAt: 1 });

    expect(await h.adapter.redeemStoreCredit('SC-2', 6)).toBeNull();
    expect(await h.adapter.redeemStoreCredit('SC-OLD', 1)).toBeNull();
    expect(await h.adapter.redeemStoreCredit('NOPE', 1)).toBeNull();
    expect(await h.adapter.getStoreCreditByCode('NOPE')).toBeNull();
  });

  it('wraps a duplicate code as a DatabaseError', async () => {
    await h.adapter.createStoreCredit({ code: 'DUP', originalAmount: 5, remainingAmount: 5 });

    await expect(h.adapter.createStoreCredit({ code: 'DUP', originalAmount: 5, remainingAmount: 5 })).rejects.toThrow(
      'Failed to create store credit'
    );
  });
});

describeSqlite('returns on SQLite', () => {
  const h = useFreshSqlite();

  async function orderWithReturn(status = 'pending', extra: Record<string, unknown> = {}) {
    const { productId, variantId } = await seedProduct(h.adapter, `W${Math.random()}`, 10);
    const order = await h.adapter.createOrder({
      items: [line(productId, variantId, 2)],
      subtotal: 10,
      total: 10,
      paymentMethod: 'Cash',
    });
    const orderItemId = String((order.items as Record<string, unknown>[])[0].id);
    const ret = await h.adapter.createReturn({
      originalOrderId: order.id,
      returnNumber: `R-${Math.random()}`,
      status,
      subtotal: 5,
      total: 5,
      reasonCode: 'damaged',
      items: [
        {
          originalOrderItemId: orderItemId,
          productId,
          variantId,
          nameSnapshot: 'Widget',
          originalQuantity: 2,
          returnQuantity: 1,
          unitPrice: 5,
          lineTotal: 5,
        },
      ],
      ...extra,
    });
    return { order, ret, productId, variantId };
  }

  it('writes the return with its items, without restocking on creation', async () => {
    const { ret, order, productId } = await orderWithReturn();

    expect(ret).toMatchObject({ originalOrderId: order.id, total: 5, originalOrderTotal: 10, restockItems: true });
    expect(ret.items).toEqual([expect.objectContaining({ returnQuantity: 1, restocked: false, condition: 'good' })]);
    expect((await h.adapter.getProductById(productId)).variants[0].stock).toBe(8);
  });

  it('is found through its order, with items grouped by their own return', async () => {
    const { order, ret } = await orderWithReturn();

    const byOrder = await h.adapter.getReturnsByOrder(String(order.id));
    const summaries = await h.adapter.getReturnSummariesByOrderIds([String(order.id), 'none']);

    expect(byOrder).toEqual([expect.objectContaining({ id: ret.id, items: [expect.objectContaining({ returnQuantity: 1 })] })]);
    expect(summaries.map((r) => r.id)).toEqual([ret.id]);
    expect(await h.adapter.getReturnSummariesByOrderIds([])).toEqual([]);
    expect(await h.adapter.getReturnsByOrder('none')).toEqual([]);
  });

  it('restocks the returned quantity once, and only the items it was given', async () => {
    const { ret, productId } = await orderWithReturn();
    const itemId = String(ret.items[0].id);

    expect(await h.adapter.restockReturnItems(String(ret.id), ['other'])).toEqual([]);
    expect(await h.adapter.restockReturnItems(String(ret.id), [itemId])).toEqual([
      expect.objectContaining({ id: itemId, quantity: 1 }),
    ]);
    expect(await h.adapter.restockReturnItems(String(ret.id))).toEqual([]);
    expect((await h.adapter.getProductById(productId)).variants[0].stock).toBe(9);
    expect((await h.adapter.getReturnById(String(ret.id))).items[0].restocked).toBe(true);
  });

  it('moves a return through approval and refund', async () => {
    const approver = await seedUser(h.adapter, 'mgr@example.com', 'Manager');
    const { ret } = await orderWithReturn();

    const approved = await h.adapter.updateReturnStatus(String(ret.id), { status: 'approved', approvedBy: approver });
    const refunded = await h.adapter.updateReturnRefundStatus(String(ret.id), {
      refundStatus: 'completed',
      refundMethod: 'store_credit',
      storeCreditCode: 'SC-R',
      storeCreditAmount: 5,
      refundProcessedAt: 123,
    });

    expect(approved).toMatchObject({ status: 'approved', approvedByName: 'Manager' });
    expect(refunded).toMatchObject({ refundStatus: 'completed', storeCreditCode: 'SC-R', storeCreditAmount: 5, refundProcessedAt: 123 });
    expect(await h.adapter.updateReturnStatus('missing', { status: 'approved' })).toBeNull();
  });

  it('lists and filters returns by status, customer and date, and reports stats', async () => {
    const customer = String((await h.adapter.createCustomer({ name: 'Ada' })).id);
    const done = await orderWithReturn('completed', { customerId: customer, refundMethod: 'store_credit' });
    // createReturn does not write store_credit_amount; the refund step does.
    await h.adapter.updateReturnRefundStatus(String(done.ret.id), { storeCreditAmount: 5 });
    const pending = await orderWithReturn('pending');
    await orderWithReturn('rejected');
    backdate(h.db, 'returns', String(done.ret.id), 1_000);

    expect((await h.adapter.getAllReturns()).length).toBe(3);
    expect((await h.adapter.getAllReturns({ status: 'pending' })).map((r) => r.id)).toEqual([pending.ret.id]);
    expect((await h.adapter.getAllReturns({ customerId: customer }))[0]).toMatchObject({ customerName: 'Ada' });
    expect((await h.adapter.getAllReturns({ startDate: 500, endDate: 1_500 })).map((r) => r.id)).toEqual([done.ret.id]);
    expect((await h.adapter.getReturnsByCustomer(customer)).map((r) => r.id)).toEqual([done.ret.id]);

    expect(await h.adapter.getReturnStats()).toEqual({
      totalReturns: 3,
      completedReturns: 1,
      pendingReturns: 1,
      rejectedReturns: 1,
      totalRefunded: 5,
      totalStoreCredits: 5,
      uniqueCustomers: 1,
    });
    expect(await h.adapter.getReturnStats({ startDate: 500, endDate: 1_500 })).toMatchObject({ totalReturns: 1 });
    expect(await h.adapter.getReturnById('missing')).toBeNull();
  });

  it('wraps a bad return as a DatabaseError', async () => {
    // original_order_id must reference a real order.
    await expect(h.adapter.createReturn({ originalOrderId: 'missing', returnNumber: 'R', total: 1, subtotal: 1 })).rejects.toThrow(
      'Failed to create return'
    );
  });
});

describeSqlite('refunds, receipts and terminal records on SQLite', () => {
  const h = useFreshSqlite();

  it('records a refund, defaulting currency and stamping completion, and marks one failed', async () => {
    const order = await sell(h);

    const done = await h.adapter.createRefundTransaction({
      orderId: order.id, transactionType: 'refund', amount: 4.5, paymentMethod: 'card', processorTransactionId: 're_1',
    });
    const pending = await h.adapter.createRefundTransaction({
      orderId: order.id, transactionType: 'refund', amount: 1, paymentMethod: 'card', status: 'pending',
    });
    await h.adapter.markRefundFailed('re_1', 'card_declined');

    expect(done).toMatchObject({ currency: 'USD', amount: 4.5, status: 'completed' });
    expect(done.completed_at).toEqual(expect.any(Number));
    expect(pending.completed_at).toBeNull();
    expect(h.db.prepare('SELECT status, failure_reason, completed_at FROM refund_transactions WHERE id = ?').get(done.id)).toEqual({
      status: 'failed', failure_reason: 'card_declined', completed_at: null,
    });
  });

  it('records receipt emails, successes and failures, newest first', async () => {
    const order = await sell(h);
    const sender = await seedUser(h.adapter, 'clerk@example.com', 'Clerk');
    const sent = await h.adapter.logReceiptEmail({ orderId: order.id, recipientEmail: 'a@example.com', receiptType: 'sale', sentBy: sender });
    const failed = await h.adapter.logReceiptEmail({ orderId: order.id, recipientEmail: 'b@example.com', receiptType: 'sale', status: 'failed' });
    backdate(h.db, 'receipt_emails', sent.id, 1_000, 'sent_at');

    const history = await h.adapter.getReceiptEmailHistory(String(order.id));

    expect(history.map((r) => [r.id, r.status])).toEqual([[failed.id, 'failed'], [sent.id, 'sent']]);
    expect(history[1]).toMatchObject({ sentByName: 'Clerk' });
    expect(await h.adapter.getReceiptEmailHistory('never')).toEqual([]);
  });

  it('records a terminal charge and updates only the given fields by charge id', async () => {
    const order = await sell(h);
    const { id } = await h.adapter.createTerminalTransaction({
      amount: 1234, currency: 'USD', provider: 'stripe', chargeId: 'ch_9', status: 'pending', startedAt: 1_000,
    });

    await h.adapter.updateTerminalTransactionByChargeId('ch_9', { status: 'succeeded', authCode: 'A1', orderId: String(order.id), durationMs: 900, errorMessage: 'none' });
    await h.adapter.updateTerminalTransactionByChargeId('ch_9', {});
    await h.adapter.updateTerminalTransactionByChargeId('ch_unknown', { status: 'failed' });

    expect(h.db.prepare('SELECT amount, status, auth_code, order_id, duration_ms, reader_id FROM terminal_transactions WHERE id = ?').get(id)).toEqual({
      amount: 1234, status: 'succeeded', auth_code: 'A1', order_id: order.id, duration_ms: 900, reader_id: null,
    });
  });
});

describeSqlite('payment attempts and webhooks on SQLite', () => {
  const h = useFreshSqlite();

  it('creates an attempt with its cart, patches it, and finds it by charge', async () => {
    const cart = { lines: [{ sku: 'A', qty: 1 }] };
    const attempt = await h.adapter.createPaymentAttempt({
      amountCents: 1999, currency: 'USD', provider: 'stripe', registerId: MAIN_REGISTER, cartSnapshot: cart,
    } as never);

    expect(attempt).toMatchObject({ status: 'pending', amountCents: 1999, cartSnapshot: cart, orderId: null });

    const order = await sell(h);
    const patched = await h.adapter.updatePaymentAttempt(attempt.id, { status: 'captured', chargeId: 'ch_1', orderId: String(order.id) } as never);
    expect(patched).toMatchObject({ status: 'captured', chargeId: 'ch_1', orderId: order.id });
    expect(await h.adapter.updatePaymentAttempt(attempt.id, {} as never)).toMatchObject({ status: 'captured' });
    expect((await h.adapter.getPaymentAttemptByChargeId('ch_1'))?.id).toBe(attempt.id);
    expect(await h.adapter.getPaymentAttemptByChargeId('ch_none')).toBeNull();
    expect(await h.adapter.getPaymentAttemptById('missing')).toBeNull();
  });

  it('refuses a non-positive amount through the CHECK constraint', async () => {
    await expect(
      h.adapter.createPaymentAttempt({ amountCents: 0, currency: 'USD', provider: 'stripe' } as never)
    ).rejects.toThrow('Failed to record the payment attempt');
  });

  it('lists only unreconciled pending or authorized attempts, oldest first', async () => {
    const older = await h.adapter.createPaymentAttempt({ amountCents: 100, currency: 'USD', provider: 'x' } as never);
    const newer = await h.adapter.createPaymentAttempt({ amountCents: 200, currency: 'USD', provider: 'x' } as never);
    const failed = await h.adapter.createPaymentAttempt({ amountCents: 300, currency: 'USD', provider: 'x' } as never);
    await h.adapter.updatePaymentAttempt(failed.id, { status: 'failed', failureReason: 'declined' } as never);
    await h.adapter.updatePaymentAttempt(newer.id, { status: 'authorized' } as never);
    backdate(h.db, 'payment_attempts', older.id, 1_000);
    backdate(h.db, 'payment_attempts', newer.id, 2_000);

    const rows = await h.adapter.listUnreconciledAttempts();

    expect(rows.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(await h.adapter.listUnreconciledAttempts({ limit: 1 })).toHaveLength(1);
    expect(await h.adapter.listUnreconciledAttempts({ olderThanMs: Date.now() })).toEqual([]);
  });

  it('claims a webhook event exactly once and records how it was handled', async () => {
    expect(await h.adapter.claimWebhookEvent({ id: 'evt_1', type: 'charge.succeeded', chargeId: 'ch_1' })).toBe(true);
    expect(await h.adapter.claimWebhookEvent({ id: 'evt_1', type: 'charge.succeeded' })).toBe(false);

    await h.adapter.markWebhookEventHandled('evt_1', 'boom');

    expect(h.db.prepare('SELECT handler_error, handled_at IS NOT NULL AS handled FROM webhook_events WHERE id = ?').get('evt_1')).toEqual({
      handler_error: 'boom', handled: 1,
    });
  });
});
