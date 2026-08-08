import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Service catalog and quote SQL against a real Postgres.
 *
 * `createQuote` writes the quote and its lines in one transaction, and
 * `getQuoteById` reassembles them — so a quote that saves its header but loses
 * its lines is priced at a total nobody can account for. That is the shape of
 * failure a mocked adapter cannot show.
 */
let h: Harness;
const mark = tag();

const serviceIds: string[] = [];
const quoteIds: string[] = [];

async function makeService(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createService({
    name: `${mark} Repair`,
    category: `${mark}Bench`,
    basePrice: 40,
    unitType: 'flat',
    isActive: true,
    ...overrides,
  });
  serviceIds.push(String(created.id));
  return created;
}

async function makeQuote(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createQuote({
    status: 'draft',
    subtotal: 80,
    taxTotal: 0,
    total: 80,
    items: [
      { description: `${mark} bench repair`, quantity: 2, unitPrice: 40, lineTotal: 80 },
    ],
    ...overrides,
  });
  quoteIds.push(String(created.id));
  return created;
}

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (quoteIds.length > 0) {
    await h.query('DELETE FROM quote_items WHERE quote_id = ANY($1)', [quoteIds]);
    await h.query('DELETE FROM quotes WHERE id = ANY($1)', [quoteIds]);
  }
  if (serviceIds.length > 0) {
    await h.query('DELETE FROM services WHERE id = ANY($1)', [serviceIds]);
  }
  await h.close();
});

describe('services', () => {
  it('creates one and reads it back', async () => {
    const created = await makeService();

    const found = await h.adapter.getServiceById(String(created.id));
    expect(found).toMatchObject({ name: `${mark} Repair`, basePrice: 40 });
  });

  it('defaults unitType to flat rather than leaving it null', async () => {
    // The column feeds pricing; a null unit type has no meaning downstream.
    const created = await makeService({ unitType: undefined });

    expect(await h.adapter.getServiceById(String(created.id))).toMatchObject({ unitType: 'flat' });
  });

  it('defaults isActive on, so a new service is sellable', async () => {
    const created = await makeService({ isActive: undefined });

    expect(await h.adapter.getServiceById(String(created.id))).toMatchObject({ isActive: true });
  });

  it('honours an explicit false for isActive', async () => {
    // `isActive !== false` in the insert: `false` is a real value here, and
    // treating it as absent would make it impossible to create a draft service.
    const created = await makeService({ isActive: false });

    expect(await h.adapter.getServiceById(String(created.id))).toMatchObject({ isActive: false });
  });

  it('updates without blanking what was left out', async () => {
    const created = await makeService({ description: 'keep me' });

    await h.adapter.updateService(String(created.id), { basePrice: 55 });

    expect(await h.adapter.getServiceById(String(created.id))).toMatchObject({
      basePrice: 55,
      description: 'keep me',
    });
  });

  it('returns null for one that does not exist', async () => {
    expect(await h.adapter.getServiceById('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });

  it('deletes one', async () => {
    const created = await makeService();

    expect(await h.adapter.deleteService(String(created.id))).toBe(true);
    expect(await h.adapter.getServiceById(String(created.id))).toBeNull();
  });

  it('reports false when there was nothing to delete', async () => {
    expect(await h.adapter.deleteService('00000000-0000-0000-0000-0000000000ff')).toBe(false);
  });
});

describe('quotes', () => {
  it('writes the quote and its lines together', async () => {
    const created = await makeQuote();

    const { rows } = await h.query('SELECT * FROM quote_items WHERE quote_id = $1', [created.id]);
    expect(rows).toHaveLength(1);
  });

  it('reads back with its lines attached', async () => {
    // A quote whose header saved but whose lines did not is priced at a total
    // nobody can account for.
    const created = await makeQuote();

    const found = await h.adapter.getQuoteById(String(created.id));
    expect(found.items).toHaveLength(1);
    expect(found.total).toBe(80);
  });

  it('keeps money exact', async () => {
    const created = await makeQuote({ subtotal: 0.1, taxTotal: 0.2, total: 0.3 });

    expect(await h.adapter.getQuoteById(String(created.id))).toMatchObject({ total: 0.3 });
  });

  it('preserves a fractional quantity, for hourly work', async () => {
    const created = await makeQuote({
      items: [{ description: `${mark} diagnosis`, quantity: 0.5, unitPrice: 80, lineTotal: 40 }],
      subtotal: 40,
      total: 40,
    });

    const found = await h.adapter.getQuoteById(String(created.id));
    expect(Number(found.items[0].quantity)).toBe(0.5);
  });

  it('moves through its statuses', async () => {
    const created = await makeQuote();

    const updated = await h.adapter.updateQuoteStatus(String(created.id), 'accepted');

    expect(updated.status).toBe('accepted');
  });

  it('returns null when the status change targets nothing', async () => {
    expect(
      await h.adapter.updateQuoteStatus('00000000-0000-0000-0000-0000000000ff', 'accepted')
    ).toBeNull();
  });

  it('finds a customer’s quotes', async () => {
    const customer = await h.adapter.createCustomer({
      name: `${mark} Buyer`,
      email: `${mark}-q@example.com`,
    });
    const created = await makeQuote({ customerId: customer.id });

    const forCustomer = await h.adapter.getQuotesByCustomer(String(customer.id));

    expect(forCustomer.map((q) => String(q.id))).toContain(String(created.id));
    await h.query('DELETE FROM quote_items WHERE quote_id = $1', [created.id]);
    await h.query('DELETE FROM quotes WHERE id = $1', [created.id]);
    await h.query('DELETE FROM customers WHERE id = $1', [customer.id]);
    quoteIds.splice(quoteIds.indexOf(String(created.id)), 1);
  });

  it('deletes the quote and its lines', async () => {
    const created = await makeQuote();

    await h.adapter.deleteQuote(String(created.id));

    const { rows } = await h.query('SELECT * FROM quote_items WHERE quote_id = $1', [created.id]);
    expect(rows).toHaveLength(0);
    quoteIds.splice(quoteIds.indexOf(String(created.id)), 1);
  });
});
