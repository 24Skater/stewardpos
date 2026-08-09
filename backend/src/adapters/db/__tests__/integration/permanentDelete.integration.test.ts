import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Permanently deleting a customer.
 *
 * This is the most destructive operation in the system: it erases the customer
 * and everything referring to them — orders, returns, refunds, store credits,
 * discount usage, loyalty. It is a right-to-be-forgotten erasure rather than a
 * tidy-up, which is why it is admin-only.
 *
 * It was completely untested, and it is exactly the kind of code where being
 * *slightly* too broad is unrecoverable: orders are matched by **email**, not
 * id, because `orders` has no `customer_id`. That is correct here — the sibling
 * `archiveCustomer` had the same lookup wrong and crashed for years — but it
 * means the blast radius is "every order with this address", so the boundary
 * deserves a test rather than a reading.
 */
let h: Harness;
const mark = tag();

const customerIds: string[] = [];

async function makeCustomer(suffix: string, email?: string | null) {
  const created = await h.adapter.createCustomer({
    name: `${mark} ${suffix}`,
    email: email === null ? null : (email ?? `${mark}-${suffix}@example.com`),
  });
  customerIds.push(String(created.id));
  return created;
}

async function makeOrderFor(email: string | null) {
  return h.adapter.createOrder({
    items: [],
    subtotal: 10,
    discountTotal: 0,
    taxTotal: 0,
    total: 10,
    paymentMethod: 'Cash',
    customerEmail: email,
    payments: [{ method: 'cash', amount: 10 }],
  });
}

const orderExists = async (id: string): Promise<boolean> =>
  (await h.query('SELECT id FROM orders WHERE id = $1', [id])).rows.length > 0;

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (customerIds.length > 0) {
    await h.query('DELETE FROM customers WHERE id = ANY($1)', [customerIds]);
  }
  await h.query('DELETE FROM orders WHERE customer_email LIKE $1', [`${mark}%`]);
  await h.close();
});

describe('permanentDeleteCustomer', () => {
  it('removes the customer', async () => {
    const customer = await makeCustomer('gone');

    expect(await h.adapter.permanentDeleteCustomer(String(customer.id))).toBe(true);
    expect(await h.adapter.getCustomerById(String(customer.id))).toBeNull();
  });

  it('removes their orders, matched on email', async () => {
    const customer = await makeCustomer('withorders');
    const order = await makeOrderFor(String(customer.email));

    await h.adapter.permanentDeleteCustomer(String(customer.id));

    expect(await orderExists(String(order.id))).toBe(false);
  });

  it('leaves another customer’s orders alone', async () => {
    // The boundary that matters. Matching on email means the blast radius is
    // "every order with this address", so anything outside it must survive.
    const doomed = await makeCustomer('doomed');
    const bystander = await makeCustomer('bystander');
    const theirs = await makeOrderFor(String(doomed.email));
    const others = await makeOrderFor(String(bystander.email));

    await h.adapter.permanentDeleteCustomer(String(doomed.id));

    expect(await orderExists(String(theirs.id))).toBe(false);
    expect(await orderExists(String(others.id))).toBe(true);
    expect(await h.adapter.getCustomerById(String(bystander.id))).toBeTruthy();
  });

  it('does not touch walk-in orders when the customer has no email', async () => {
    // A customer row with no address must not be read as "delete every order
    // that also has no address" — that is the shop's entire walk-in trade.
    const anonymous = await makeCustomer('noemail', null);
    const walkIn = await makeOrderFor(null);

    await h.adapter.permanentDeleteCustomer(String(anonymous.id));

    expect(await orderExists(String(walkIn.id))).toBe(true);
    await h.query('DELETE FROM orders WHERE id = $1', [walkIn.id]);
  });

  it('still deletes the customer when they have no email', async () => {
    const anonymous = await makeCustomer('noemail2', null);

    expect(await h.adapter.permanentDeleteCustomer(String(anonymous.id))).toBe(true);
  });

  it('removes their store credits', async () => {
    const customer = await makeCustomer('withcredit');
    const code = `${mark}-CREDIT`.toUpperCase();
    await h.adapter.createStoreCredit({
      code,
      customerId: customer.id,
      customerEmail: customer.email,
      originalAmount: 20,
      remainingAmount: 20,
      status: 'active',
      returnId: null,
      expiresAt: null,
    });

    await h.adapter.permanentDeleteCustomer(String(customer.id));

    expect(await h.adapter.getStoreCreditByCode(code)).toBeNull();
  });

  it('removes their quotes', async () => {
    const customer = await makeCustomer('withquote');
    const quote = await h.adapter.createQuote({
      customerId: customer.id,
      status: 'draft',
      subtotal: 10,
      taxTotal: 0,
      total: 10,
      items: [{ description: `${mark} thing`, quantity: 1, unitPrice: 10, lineTotal: 10 }],
    });

    await h.adapter.permanentDeleteCustomer(String(customer.id));

    const { rows } = await h.query('SELECT id FROM quotes WHERE id = $1', [quote.id]);
    expect(rows).toHaveLength(0);
  });

  it('reports false for a customer who does not exist', async () => {
    expect(
      await h.adapter.permanentDeleteCustomer('00000000-0000-0000-0000-0000000000ff')
    ).toBe(false);
  });

  it('changes nothing when the customer does not exist', async () => {
    const bystander = await makeCustomer('untouched');
    const order = await makeOrderFor(String(bystander.email));

    await h.adapter.permanentDeleteCustomer('00000000-0000-0000-0000-0000000000ff');

    expect(await orderExists(String(order.id))).toBe(true);
    expect(await h.adapter.getCustomerById(String(bystander.id))).toBeTruthy();
  });
});
