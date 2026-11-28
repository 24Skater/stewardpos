import { expect, it } from 'vitest';
import { describeSqlite, seedProduct, useFreshSqlite } from './sqliteHarness';

describeSqlite('outbox on SQLite', () => {
  const h = useFreshSqlite();

  function subscribe(events: string[], active = 1) {
    h.db
      .prepare(
        `INSERT INTO webhook_subscriptions (id, url, secret_enc, events, active, created_at)
         VALUES (lower(hex(randomblob(16))), 'https://example.test/h', 's', ?, ?, 0)`
      )
      .run(JSON.stringify(events), active);
  }

  it('fans an event out only to active, matching subscriptions', async () => {
    subscribe(['customer.created']);
    subscribe(['order.created']);
    subscribe(['customer.created'], 0);

    await h.adapter.enqueueOutboxEvent('customer.created', { id: 'c1' });

    expect(h.db.prepare('SELECT COUNT(*) AS n FROM outbox_events').get()).toMatchObject({ n: 1 });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM webhook_deliveries').get()).toMatchObject({ n: 1 });
  });

  it('claims due deliveries once, then marks them', async () => {
    subscribe(['customer.created']);
    await h.adapter.enqueueOutboxEvent('customer.created', { id: 'c1' });

    const first = await h.adapter.claimDueDeliveries(10);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ eventType: 'customer.created', payload: { id: 'c1' } });
    expect(await h.adapter.claimDueDeliveries(10)).toHaveLength(0);

    await h.adapter.markDelivery(first[0].id, {
      status: 'delivered',
      attempts: 1,
      nextAttemptAt: Date.now(),
      lastStatusCode: 200,
      lastError: null,
    });
    expect(h.db.prepare('SELECT status FROM webhook_deliveries').get()).toMatchObject({ status: 'delivered' });
  });

  it('writes order.created with the order', async () => {
    subscribe(['order.created']);
    const { productId, variantId } = await seedProduct(h.adapter, 'Widget');
    await h.adapter.createOrder({
      items: [
        { productId, variantId, nameSnapshot: 'W', quantity: 1, unitPrice: 5, lineDiscount: 0, lineTotal: 5 },
      ],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });
    expect(h.db.prepare('SELECT event_type FROM outbox_events').all()).toEqual([{ event_type: 'order.created' }]);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM webhook_deliveries').get()).toMatchObject({ n: 1 });
  });
});
