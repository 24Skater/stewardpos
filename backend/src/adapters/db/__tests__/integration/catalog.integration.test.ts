import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Catalog SQL against a real Postgres.
 *
 * Search, paging, variant COALESCE semantics, and the low-stock threshold
 * fallback. All of this was verified by hand against a live database and by
 * route tests that mock the adapter — so none of it was covered repeatably.
 */
let h: Harness;
const mark = tag();

/** Ids of the products this file creates, in creation order. */
const ids: string[] = [];

beforeAll(async () => {
  h = await connect();

  // Two products, one with two variants, all tagged so cleanup can find them.
  for (const [name, category, price, barcode] of [
    [`${mark} Loose Leaf Tea`, `${mark}Drinks`, 5, `${mark}-5010`],
    [`${mark} Shortbread`, `${mark}Snacks`, 3, `${mark}-6010`],
  ] as const) {
    const product = await h.adapter.createProduct({
      name,
      description: mark,
      category,
      basePrice: price,
      barcode,
      variants: [],
    });
    ids.push(String(product!.id));
  }

  await h.adapter.createVariant(ids[0], { size: 'Small', sku: `${mark}-TEA-S`, barcode: `${mark}-5011`, stock: 40 });
  await h.adapter.createVariant(ids[0], { size: 'Large', sku: `${mark}-TEA-L`, barcode: `${mark}-5012`, stock: 2 });
  await h.adapter.createVariant(ids[1], { sku: `${mark}-SB`, stock: 100 });
}, 30_000);

afterAll(async () => {
  await cleanup(h, mark);
  await h.close();
});

describe('getAllProducts', () => {
  it('matches on product name', async () => {
    const { products } = await h.adapter.getAllProducts({ q: `${mark} Shortbread` });

    expect(products.map((p) => p.id)).toEqual([ids[1]]);
  });

  it('matches case-insensitively', async () => {
    const { products } = await h.adapter.getAllProducts({ q: `${mark} sHoRtBrEaD` });

    expect(products).toHaveLength(1);
  });

  it('matches a variant SKU and returns the product with ALL its variants', async () => {
    // The search uses EXISTS rather than a join condition precisely so that
    // matching one variant does not return a product missing its others — which
    // would silently hide sizes from the register.
    const { products } = await h.adapter.getAllProducts({ q: `${mark}-TEA-L` });

    expect(products).toHaveLength(1);
    expect(products[0].variants).toHaveLength(2);
  });

  it('matches a variant barcode', async () => {
    const { products } = await h.adapter.getAllProducts({ q: `${mark}-5011` });

    expect(products[0].id).toBe(ids[0]);
  });

  it('filters by category exactly', async () => {
    const { products, total } = await h.adapter.getAllProducts({ category: `${mark}Drinks` });

    expect(products).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('reports the total for the whole match, not the page', async () => {
    // The count query is separate from the paged one. If it inherited LIMIT,
    // every page would claim to be the last.
    const { products, total } = await h.adapter.getAllProducts({ q: mark, limit: 1 });

    expect(products).toHaveLength(1);
    expect(total).toBe(2);
  });

  it('pages with a stable order, so offset does not repeat a row', async () => {
    const first = await h.adapter.getAllProducts({ q: mark, limit: 1, offset: 0 });
    const second = await h.adapter.getAllProducts({ q: mark, limit: 1, offset: 1 });

    expect(first.products[0].id).not.toBe(second.products[0].id);
  });

  it('returns everything when no limit is given', async () => {
    const { products } = await h.adapter.getAllProducts({ q: mark });

    expect(products).toHaveLength(2);
  });

  it('treats a wildcard in the search term as a literal', async () => {
    // The term goes into a LIKE. An unescaped `%` would match everything, so a
    // customer searching for "50%" would be shown the entire catalog.
    const { products } = await h.adapter.getAllProducts({ q: '%' });

    expect(products.filter((p) => p.description === mark)).toHaveLength(0);
  });
});

describe('updateVariant', () => {
  it('COALESCEs: a stock correction leaves size, SKU, and barcode alone', async () => {
    const before = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    const large = before.find((v) => v.size === 'Large')!;

    await h.adapter.updateVariant(ids[0], String(large.id), { stock: 7 });

    const after = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    const updated = after.find((v) => v.id === large.id)!;
    expect(updated).toMatchObject({ stock: 7, size: 'Large', sku: `${mark}-TEA-L` });
  });

  it('sets a per-variant low-stock threshold and keeps it through a stock edit', async () => {
    const variants = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    const id = String(variants[0].id);

    await h.adapter.updateVariant(ids[0], id, { lowStockThreshold: 12 });
    await h.adapter.updateVariant(ids[0], id, { stock: 41 });

    const after = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    expect(after.find((v) => v.id === id)).toMatchObject({ lowStockThreshold: 12, stock: 41 });
  });

  it('clears the threshold on an explicit null', async () => {
    // COALESCE alone reads every null as "not mentioned", so an override could
    // be set and then never removed. The CASE distinguishes the two.
    const variants = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    const id = String(variants[0].id);

    await h.adapter.updateVariant(ids[0], id, { lowStockThreshold: 9 });
    await h.adapter.updateVariant(ids[0], id, { lowStockThreshold: null });

    const after = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    expect(after.find((v) => v.id === id)!.lowStockThreshold).toBeNull();
  });

  it('returns null for a variant that belongs to a different product', async () => {
    const variants = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];

    expect(await h.adapter.updateVariant(ids[1], String(variants[0].id), { stock: 1 })).toBeNull();
  });
});

describe('deleteVariant', () => {
  it('refuses to remove the last one', async () => {
    // A product with no variants cannot be sold and there is no "unsellable"
    // state, so this would strand it in the catalog.
    const variants = (await h.adapter.getProductById(ids[1]))!.variants as Record<string, unknown>[];

    expect(await h.adapter.deleteVariant(ids[1], String(variants[0].id))).toBe('last');
  });
});

describe('getLowStockVariants', () => {
  it('uses the store default when a variant sets none', async () => {
    const low = await h.adapter.getLowStockVariants(5);

    // Large was left at 7 above, Small at 41, Shortbread at 100 — none under 5.
    expect(low.filter((v) => String(v.productId) === ids[0])).toHaveLength(0);
  });

  it('reports the variant once its stock reaches the threshold', async () => {
    const low = await h.adapter.getLowStockVariants(10);

    const tea = low.filter((v) => String(v.productId) === ids[0]);
    expect(tea).toHaveLength(1);
    expect(tea[0]).toMatchObject({ productName: `${mark} Loose Leaf Tea`, stock: 7 });
  });

  it('honours a per-variant override above the store default', async () => {
    const variants = (await h.adapter.getProductById(ids[1]))!.variants as Record<string, unknown>[];
    const id = String(variants[0].id);
    await h.adapter.updateVariant(ids[1], id, { lowStockThreshold: 500 });

    const low = await h.adapter.getLowStockVariants(1);

    expect(low.find((v) => v.id === id)).toMatchObject({ threshold: 500 });
    await h.adapter.updateVariant(ids[1], id, { lowStockThreshold: null });
  });

  it('excludes disabled variants', async () => {
    // They are not for sale, so they cannot run out, and including them buries
    // the real shortages under discontinued ones.
    const variants = (await h.adapter.getProductById(ids[0]))!.variants as Record<string, unknown>[];
    const large = variants.find((v) => v.stock === 7)!;

    await h.adapter.updateVariant(ids[0], String(large.id), { enabled: false });
    const low = await h.adapter.getLowStockVariants(10);
    await h.adapter.updateVariant(ids[0], String(large.id), { enabled: true });

    expect(low.find((v) => v.id === large.id)).toBeUndefined();
  });

  it('orders by shortfall, so the most urgent comes first', async () => {
    const low = await h.adapter.getLowStockVariants(1000);
    const mine = low.filter((v) => ids.includes(String(v.productId)));

    const shortfalls = mine.map((v) => Number(v.stock) - Number(v.threshold));
    expect(shortfalls).toEqual([...shortfalls].sort((a, b) => a - b));
  });
});
