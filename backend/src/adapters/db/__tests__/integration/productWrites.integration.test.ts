import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Product create, update, and delete — and the order reads that go with them.
 *
 * `createProduct` writes the product and its nested variants in one
 * transaction; `updateProduct` COALESCEs, so a partial edit must not blank the
 * description or the barcode. Both were reached only through routes that mock
 * the adapter, so neither had been executed.
 */
let h: Harness;
const mark = tag();

async function makeProduct(overrides: Record<string, unknown> = {}) {
  return h.adapter.createProduct({
    name: `${mark} Tea`,
    description: mark,
    category: `${mark}Drinks`,
    basePrice: 5,
    barcode: `${mark}-5010`,
    variants: [{ size: 'Small', sku: `${mark}-S`, stock: 10 }],
    ...overrides,
  });
}

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  await cleanup(h, mark);
  await h.close();
});

describe('createProduct', () => {
  it('writes the product and its nested variants together', async () => {
    const created = await makeProduct();

    const found = await h.adapter.getProductById(String(created!.id));
    expect(found!.variants).toHaveLength(1);
  });

  it('creates a product with no variants at all', async () => {
    // The catalog importer creates the product first and adds variants after,
    // so an empty list has to be allowed rather than rejected.
    const created = await makeProduct({ variants: [] });

    const found = await h.adapter.getProductById(String(created!.id));
    expect(found!.variants).toEqual([]);
  });

  it('keeps the base price exact', async () => {
    const created = await makeProduct({ basePrice: 19.99 });

    expect((await h.adapter.getProductById(String(created!.id)))!.basePrice).toBe(19.99);
  });

  it('accepts several variants at once', async () => {
    const created = await makeProduct({
      variants: [
        { size: 'Small', sku: `${mark}-A`, stock: 1 },
        { size: 'Large', sku: `${mark}-B`, stock: 2 },
      ],
    });

    expect((await h.adapter.getProductById(String(created!.id)))!.variants).toHaveLength(2);
  });
});

describe('updateProduct', () => {
  it('COALESCEs: changing the price leaves the description and barcode alone', async () => {
    // The bug this guards was real once: a partial update blanked every field
    // the caller did not mention, so editing a price erased the barcode and the
    // product stopped scanning.
    const created = await makeProduct();

    await h.adapter.updateProduct(String(created!.id), { basePrice: 7 });

    const found = await h.adapter.getProductById(String(created!.id));
    expect(found).toMatchObject({
      basePrice: 7,
      description: mark,
      barcode: `${mark}-5010`,
    });
  });

  it('changes the category', async () => {
    const created = await makeProduct();

    await h.adapter.updateProduct(String(created!.id), { category: `${mark}Snacks` });

    expect((await h.adapter.getProductById(String(created!.id)))!.category).toBe(`${mark}Snacks`);
  });

  it('leaves the variants untouched', async () => {
    // `updateProduct` carries no variant payload; variants move through their
    // own sub-resource. An update must not quietly drop them.
    const created = await makeProduct();

    await h.adapter.updateProduct(String(created!.id), { name: `${mark} Renamed` });

    expect((await h.adapter.getProductById(String(created!.id)))!.variants).toHaveLength(1);
  });

  it('returns null for a product that does not exist', async () => {
    expect(
      await h.adapter.updateProduct('00000000-0000-0000-0000-0000000000ff', { basePrice: 1 })
    ).toBeNull();
  });
});

describe('deleteProduct', () => {
  it('removes the product and its variants', async () => {
    const created = await makeProduct();
    const id = String(created!.id);

    expect(await h.adapter.deleteProduct(id)).toBe(true);
    expect(await h.adapter.getProductById(id)).toBeNull();

    const { rows } = await h.query('SELECT id FROM product_variants WHERE product_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('reports false when there was nothing to delete', async () => {
    expect(await h.adapter.deleteProduct('00000000-0000-0000-0000-0000000000ff')).toBe(false);
  });
});

describe('getProductById', () => {
  it('returns null rather than throwing for an unknown id', async () => {
    expect(await h.adapter.getProductById('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});

describe('getAllOrders', () => {
  it('returns orders newest first', async () => {
    // The receipts screen shows this list, and a shop looks for the sale it
    // just rang up — which has to be at the top.
    const product = await makeProduct();
    const variant = (await h.adapter.getProductById(String(product!.id)))!
      .variants as Record<string, unknown>[];

    const line = {
      productId: product!.id,
      variantId: variant[0].id,
      nameSnapshot: `${mark} Tea`,
      quantity: 1,
      unitPrice: 5,
      lineDiscount: 0,
      lineTotal: 5,
    };
    const first = await h.adapter.createOrder({
      items: [line],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });
    const second = await h.adapter.createOrder({
      items: [line],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 5 }],
    });

    const all = await h.adapter.getAllOrders();
    const positions = [String(second.id), String(first.id)].map((id) =>
      all.findIndex((o) => String(o.id) === id)
    );

    expect(positions[0]).toBeLessThan(positions[1]);

    for (const id of [first.id, second.id]) {
      await h.query('DELETE FROM payments WHERE order_id = $1', [id]);
      await h.query('DELETE FROM order_items WHERE order_id = $1', [id]);
      await h.query('DELETE FROM orders WHERE id = $1', [id]);
    }
  });
});
