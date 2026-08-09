import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * The SQLite adapter's queries, actually executed.
 *
 * Every deployment here uses Postgres and CI provisions Postgres only, so the
 * SQLite adapter's SQL has never run anywhere — it is written, typechecked, and
 * never executed. That matters most for the places where the two dialects
 * differ, and the sharpest of those is the `ESCAPE` clause: Postgres treats
 * backslash as the default LIKE escape, SQLite has none and needs it spelled
 * out. Getting the JavaScript escaping wrong there produces `ESCAPE ''`, which
 * SQLite rejects outright — a broken search rather than a wrong one, and
 * invisible until someone runs on SQLite.
 *
 * Skips when the native binding is unavailable (building it on Windows needs
 * MSVC) and **throws in CI**, where a skip would mean this covers nothing.
 */
function sqliteAvailable(): boolean {
  try {
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

const available = sqliteAvailable();

if (!available && process.env.CI) {
  throw new Error(
    'better-sqlite3 has no usable native binding. In CI this is a failure, not a skip: ' +
      'these are the only tests that execute the SQLite adapter.'
  );
}

const describeSqlite = available ? describe : describe.skip;

const { default: config } = await import('../../../config');
const original = { ...config.database };

let filename: string;
let adapter: InstanceType<typeof import('../SQLiteAdapter').SQLiteAdapter>;
let productId: string;

beforeAll(async () => {
  if (!available) return;

  filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sqlite-')), 'test.db');
  config.database.adapter = 'sqlite';
  config.database.filename = filename;

  const { Migrator } = await import('../../../services/migrator');
  const migrator = new Migrator();
  await migrator.runMigrations();
  await migrator.close();

  const { SQLiteAdapter } = await import('../SQLiteAdapter');
  adapter = new SQLiteAdapter({ filename });

  const product = await adapter.createProduct({
    name: 'Loose Leaf Tea',
    description: 'probe',
    category: 'Drinks',
    basePrice: 5,
    barcode: '5010',
    variants: [],
  });
  productId = String(product!.id);
  await adapter.createVariant(productId, { size: 'Small', sku: 'TEA-S', barcode: '5011', stock: 4 });
  await adapter.createVariant(productId, { size: 'Large', sku: 'TEA-L', barcode: '5012', stock: 40 });

  await adapter.createProduct({
    name: '50% Off Sampler',
    description: 'probe',
    category: 'Drinks',
    basePrice: 2,
    variants: [{ sku: 'SAMP', stock: 10 }],
  });
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await adapter?.close?.();
  Object.assign(config.database, original);
  fs.rmSync(path.dirname(filename), { recursive: true, force: true });
});

describeSqlite('catalog search on SQLite', () => {
  it('finds a product by name', async () => {
    const { products } = await adapter.getAllProducts({ q: 'Loose Leaf' });

    expect(products).toHaveLength(1);
  });

  it('is case-insensitive, via COLLATE NOCASE', async () => {
    const { products } = await adapter.getAllProducts({ q: 'lOoSe LeAf' });

    expect(products).toHaveLength(1);
  });

  it('finds a product by a variant SKU, returning all its variants', async () => {
    const { products } = await adapter.getAllProducts({ q: 'TEA-L' });

    expect(products).toHaveLength(1);
    expect(products[0].variants).toHaveLength(2);
  });

  it('runs the ESCAPE clause at all', async () => {
    // If the escape character were malformed — `ESCAPE ''` is the easy mistake —
    // SQLite would raise rather than return rows, so this failing is the whole
    // point of executing the dialect.
    await expect(adapter.getAllProducts({ q: 'Tea' })).resolves.toBeTruthy();
  });

  it('treats a wildcard as a literal', async () => {
    // Searching `%` must match only products whose name actually contains one —
    // here the sampler — rather than every row in the catalog. My first version
    // of this expected zero results, which was wrong: "50% Off Sampler" is a
    // genuine match, and the escaping working is precisely why.
    const { products } = await adapter.getAllProducts({ q: '%' });

    expect(products.map((p) => p.name)).toEqual(['50% Off Sampler']);
  });

  it('matches a literal percent sign in a name', async () => {
    const { products } = await adapter.getAllProducts({ q: '50%' });

    expect(products.map((p) => p.name)).toEqual(['50% Off Sampler']);
  });

  it('treats an underscore as a literal', async () => {
    const { products } = await adapter.getAllProducts({ q: 'Lo_se' });

    expect(products).toHaveLength(0);
  });

  it('filters by category and reports a total', async () => {
    const { products, total } = await adapter.getAllProducts({ category: 'Drinks' });

    expect(products).toHaveLength(2);
    expect(total).toBe(2);
  });

  it('pages', async () => {
    const { products, total } = await adapter.getAllProducts({ limit: 1 });

    expect(products).toHaveLength(1);
    expect(total).toBe(2);
  });
});

describeSqlite('order search on SQLite', () => {
  it('runs, with its own ESCAPE clause', async () => {
    // The order-search escape is written as a double-quoted string rather than a
    // template literal, which is a different JavaScript escaping problem from
    // the catalog's. Executing it is the only way to tell them apart.
    await expect(adapter.searchOrders({ query: 'anything' })).resolves.toBeTruthy();
  });

  it('treats a wildcard as a literal there too', async () => {
    const order = await adapter.createOrder({
      items: [],
      subtotal: 10,
      discountTotal: 0,
      taxTotal: 0,
      total: 10,
      paymentMethod: 'Cash',
      customerEmail: 'ada@example.com',
      payments: [{ method: 'cash', amount: 10 }],
    });

    expect(await adapter.searchOrders({ query: '%' })).toHaveLength(0);
    expect(await adapter.searchOrders({ query: 'ada@' })).toHaveLength(1);
    expect(String(order.id)).toBeTruthy();
  });
});

describeSqlite('variant writes on SQLite', () => {
  it('COALESCEs a partial update', async () => {
    const product = await adapter.getProductById(productId);
    const variant = (product!.variants as Record<string, unknown>[])[0];

    await adapter.updateVariant(productId, String(variant.id), { stock: 7 });

    const after = await adapter.getProductById(productId);
    expect((after!.variants as Record<string, unknown>[])[0]).toMatchObject({
      stock: 7,
      sku: variant.sku,
    });
  });

  it('clears a low-stock threshold on an explicit null', async () => {
    // The CASE that distinguishes "not mentioned" from "clear this" is written
    // differently in each dialect; only SQLite's has never run.
    const product = await adapter.getProductById(productId);
    const variant = (product!.variants as Record<string, unknown>[])[0];

    await adapter.updateVariant(productId, String(variant.id), { lowStockThreshold: 9 });
    await adapter.updateVariant(productId, String(variant.id), { lowStockThreshold: null });

    const after = await adapter.getProductById(productId);
    expect((after!.variants as Record<string, unknown>[])[0].lowStockThreshold).toBeNull();
  });

  it('reports low stock against the store default', async () => {
    const low = await adapter.getLowStockVariants(10);

    expect(low.length).toBeGreaterThan(0);
  });
});
