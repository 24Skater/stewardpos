// Every event type we emit. Receivers subscribe by these names, so adding one
// here is a public API change.
export const EVENT_CATALOG = {
  'order.created': 'A sale was completed.',
  'order.refunded': 'A return or refund was recorded against an order.',
  'customer.created': 'A customer record was created.',
} as const;

export type EventType = keyof typeof EVENT_CATALOG;

interface OutboxAdapter {
  enqueueOutboxEvent(type: string, data: unknown): Promise<void>;
}

/**
 * Write an event and fan it out to matching active subscriptions. Delivery
 * happens later in the job runner, never on the caller's request path.
 *
 * order.created and order.refunded are written inside the order/return
 * transaction by the adapters themselves; this standalone form is for changes
 * that have no transaction of their own.
 */
export async function enqueueEvent(adapter: OutboxAdapter, type: EventType, data: unknown): Promise<void> {
  if (!(type in EVENT_CATALOG)) throw new Error(`Unknown event type: ${type}`);
  await adapter.enqueueOutboxEvent(type, data);
}
