import { expect, it } from 'vitest';
import { describeSqlite, useFreshSqlite } from './sqliteHarness';

describeSqlite('webhook subscription admin on SQLite', () => {
  const h = useFreshSqlite();

  it('creates, updates, rotates and deletes a subscription', async () => {
    const sub = await h.adapter.createWebhookSubscription('https://a.example.test/h', 'enc1', ['order.created']);
    expect(sub).toMatchObject({ url: 'https://a.example.test/h', events: ['order.created'], active: true, rotating: false });

    const off = await h.adapter.updateWebhookSubscription(sub.id, { active: false });
    expect(off).toMatchObject({ active: false, url: 'https://a.example.test/h' });

    const rotated = await h.adapter.rotateWebhookSecret(sub.id, 'enc2', Date.now() + 60_000);
    expect(rotated?.rotating).toBe(true);
    expect(h.db.prepare('SELECT secret_enc, secret_prev_enc FROM webhook_subscriptions').get()).toEqual({
      secret_enc: 'enc2',
      secret_prev_enc: 'enc1',
    });

    expect(await h.adapter.deleteWebhookSubscription(sub.id)).toBe(true);
    expect(await h.adapter.deleteWebhookSubscription(sub.id)).toBe(false);
    expect(await h.adapter.rotateWebhookSecret('missing', 'x', 0)).toBeNull();
  });

  it('lists deliveries by status and requeues one', async () => {
    await h.adapter.createWebhookSubscription('https://a.example.test/h', 'enc1', ['customer.created']);
    await h.adapter.enqueueOutboxEvent('customer.created', { id: 'c1' });
    const [row] = await h.adapter.listWebhookDeliveries(undefined, 10);
    expect(row).toMatchObject({ eventType: 'customer.created', status: 'pending' });

    await h.adapter.markDelivery(row.id, {
      status: 'dead',
      attempts: 6,
      nextAttemptAt: 0,
      lastStatusCode: 500,
      lastError: 'HTTP 500',
    });
    expect(await h.adapter.listWebhookDeliveries('pending', 10)).toHaveLength(0);
    expect(await h.adapter.listWebhookDeliveries('dead', 10)).toHaveLength(1);

    expect(await h.adapter.redeliverWebhook(row.id)).toBe(true);
    expect(await h.adapter.listWebhookDeliveries('pending', 10)).toHaveLength(1);
    expect(await h.adapter.redeliverWebhook('missing')).toBe(false);
  });
});
