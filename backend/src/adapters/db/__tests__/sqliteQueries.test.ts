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

describeSqlite('reporting aggregations on SQLite', () => {
  /**
   * The reporting SQL differs between the dialects in two places, and both are
   * invisible without executing it: `orders.created_at` is epoch milliseconds
   * here and a TIMESTAMP in Postgres, so the range predicate is written
   * differently; and the daily bucket needs `strftime(..., 'unixepoch')` rather
   * than `to_char`, which is the sort of expression that typechecks perfectly
   * and returns nothing.
   *
   * Back-dated into a window the rest of this file does not touch, since these
   * queries sum every order in range.
   */
  const RANGE = {
    from: Date.parse('2001-01-01T00:00:00.000Z'),
    to: Date.parse('2001-01-31T23:59:59.999Z'),
  };

  /**
   * Its own product and variant, not the ones the rest of the file uses.
   *
   * Two reasons, and CI found the first of them. `order_items.variant_id` is
   * `NOT NULL`, so a line without one fails the insert outright — the earlier
   * order in this file carries no items at all, which is why nothing had caught
   * it. And `createOrder` decrements stock conditionally, so selling from a
   * variant whose stock an earlier describe has already edited would make these
   * pass or fail depending on the order the file happens to run in.
   */
  let soldProductId: string;
  let soldVariantId: string;

  beforeAll(async () => {
    if (!available) return;

    const product = await adapter.createProduct({
      name: 'Reporting Beans',
      description: 'probe',
      category: 'Drinks',
      basePrice: 5,
      variants: [],
    });
    soldProductId = String(product!.id);
    soldVariantId = String(
      (await adapter.createVariant(soldProductId, { sku: 'RPT-1', stock: 500 }))!.id
    );

    const line = (quantity: number) => ({
      productId: soldProductId,
      variantId: soldVariantId,
      nameSnapshot: 'Reporting Beans',
      quantity,
      unitPrice: 5,
      lineDiscount: 0,
      lineTotal: 5 * quantity,
    });

    const first = await adapter.createOrder({
      items: [line(3)],
      subtotal: 15,
      discountTotal: 1,
      taxTotal: 1.12,
      total: 15.12,
      paymentMethod: 'Cash',
      payments: [{ method: 'cash', amount: 15.12 }],
    });

    // No `payments` rows on the second: the pre-`payments`-table shape, which
    // the UNION's fallback branch exists for.
    const second = await adapter.createOrder({
      items: [line(1)],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Card',
    });

    const db = new Database(filename);
    db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(
      Date.parse('2001-01-10T10:00:00.000Z'),
      String(first.id)
    );
    db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(
      Date.parse('2001-01-11T10:00:00.000Z'),
      String(second.id)
    );
    db.close();
  });

  it('sums the range', async () => {
    const totals = await adapter.getSalesTotals(RANGE);

    expect(totals).toEqual({
      orderCount: 2,
      gross: 20,
      discounts: 1,
      tax: 1.12,
      net: 20.12,
    });
  });

  it('sums money to the cent despite REAL storage', async () => {
    // The reason every money aggregate here is wrapped in ROUND. Money is
    // DECIMAL(10,2) in Postgres, where a SUM is exact, but REAL here — IEEE
    // floating point. $15.12 + $5.00 comes out as 20.119999999999997, which
    // reaches a report card as "$20.119999999999997" and does not reconcile
    // against the same figures read from Postgres.
    const totals = await adapter.getSalesTotals(RANGE);

    expect(totals.net).toBe(20.12);
    expect(String(totals.net)).not.toMatch(/\d{6}/);
  });

  it('returns zeroes for an empty range rather than nulls', async () => {
    expect(await adapter.getSalesTotals({ from: 0, to: 1 })).toEqual({
      orderCount: 0,
      gross: 0,
      discounts: 0,
      tax: 0,
      net: 0,
    });
  });

  it('buckets by day through strftime', async () => {
    const days = await adapter.getSalesByDay(RANGE);

    expect(days).toEqual([
      { date: '2001-01-10', orderCount: 1, gross: 15, net: 15.12 },
      { date: '2001-01-11', orderCount: 1, gross: 5, net: 5 },
    ]);
  });

  it('ranks products and honours the limit', async () => {
    const top = await adapter.getTopProducts(RANGE, 5);

    expect(top).toEqual([
      { productId: soldProductId, name: 'Reporting Beans', quantity: 4, revenue: 20 },
    ]);
    expect(await adapter.getTopProducts(RANGE, 1)).toHaveLength(1);
  });

  it('mixes tenders from both branches of the UNION', async () => {
    // Repeated `?` placeholders: the values are passed twice here where Postgres
    // reuses $1 and $2. Getting that wrong binds the wrong parameter to the
    // fallback branch and silently returns the wrong window.
    const mix = await adapter.getPaymentMix(RANGE);

    expect(mix).toEqual([
      { method: 'cash', count: 1, amount: 15.12 },
      { method: 'card', count: 1, amount: 5 },
    ]);
  });

  it('counts only completed refunds', async () => {
    expect(await adapter.getReturnsTotals(RANGE)).toEqual({
      returnCount: 0,
      refunded: 0,
      pendingCount: 0,
      pendingAmount: 0,
    });
    expect(await adapter.getReturnsByReason(RANGE)).toEqual([]);
  });
});

/**
 * The shift log's SQL, on SQLite.
 *
 * Six joins across four tables, and one place the dialects genuinely diverge:
 * `started_at` is INTEGER milliseconds here and TIMESTAMP in Postgres, so the
 * date filters compare against a raw epoch number rather than
 * `to_timestamp()`. That is exactly the sort of difference that typechecks
 * fine and fails at runtime on whichever dialect nobody ran.
 *
 * This block also puts migration 021's SQLite half — a full `audit_logs`
 * rebuild, which SQLite needs because it cannot drop a NOT NULL in place —
 * through the migrator above, which is the only place it executes at all.
 */
describeSqlite('getRegisterShifts on SQLite', () => {
  const ORG = '00000000-0000-0000-0000-0000000000f1';
  const LOCATION = '00000000-0000-0000-0000-0000000000f2';
  let registerId: string;
  let cashierId: string;
  let openShiftId: string;

  beforeAll(async () => {
    const db = new Database(filename);
    db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
      ORG,
      'Shift Log Shop',
      'shift-log-shop'
    );
    db.prepare('INSERT INTO locations (id, org_id, name, slug) VALUES (?, ?, ?, ?)').run(
      LOCATION,
      ORG,
      'Front of House',
      'front-of-house'
    );
    db.close();

    const cashier = await adapter.createUser({
      email: 'shift.log@example.com',
      passwordHash: 'not-a-real-hash',
      name: 'Casey Cashier',
      status: 'active',
      roleIds: [],
    });
    cashierId = String(cashier.id);

    const register = await adapter.createRegister({
      org_id: ORG,
      location_id: LOCATION,
      name: 'Front Till',
      register_number: 1,
      display_code: 'FOH-01',
      status: 'active',
    });
    registerId = String((register as Record<string, unknown>).id);

    const closed = await adapter.createRegisterShift({ registerId, userId: cashierId });
    await adapter.endRegisterShift(String(closed.id), 'signed_out');

    const open = await adapter.createRegisterShift({ registerId, userId: cashierId });
    openShiftId = String(open.id);
  });

  it('joins the cashier, till and location names onto the shift', async () => {
    const { shifts, total } = await adapter.getRegisterShifts({
      orgId: ORG,
      registerId,
      limit: 50,
      offset: 0,
    });

    expect(total).toBe(2);
    expect(shifts[0]).toMatchObject({
      id: openShiftId,
      cashierName: 'Casey Cashier',
      registerName: 'Front Till',
      registerDisplayCode: 'FOH-01',
      locationName: 'Front of House',
      endedAt: null,
    });
  });

  it('filters to open shifts, by cashier, and by an epoch-millisecond range', async () => {
    const open = await adapter.getRegisterShifts({ orgId: ORG, openOnly: true, limit: 50, offset: 0 });
    expect(open.shifts.map((s) => s.id)).toEqual([openShiftId]);

    const mine = await adapter.getRegisterShifts({
      orgId: ORG,
      userId: cashierId,
      limit: 50,
      offset: 0,
    });
    expect(mine.total).toBe(2);

    // The range filter is the dialect-specific one: a bare number here, a
    // `to_timestamp()` call in Postgres.
    const longAgo = await adapter.getRegisterShifts({
      orgId: ORG,
      from: Date.parse('2001-01-01T00:00:00.000Z'),
      to: Date.parse('2001-12-31T23:59:59.999Z'),
      limit: 50,
      offset: 0,
    });
    expect(longAgo.total).toBe(0);
    expect(longAgo.shifts).toEqual([]);
  });

  it('scopes to the org, so another shop\'s till is not readable by id', async () => {
    const { total } = await adapter.getRegisterShifts({
      orgId: '00000000-0000-0000-0000-000000000001',
      registerId,
      limit: 50,
      offset: 0,
    });

    expect(total).toBe(0);
  });
});
