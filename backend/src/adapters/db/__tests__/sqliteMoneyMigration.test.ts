import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { available, describeSqlite } from './sqliteHarness';

/**
 * T-44 golden test. A database at migration 034 holds the money the old
 * REAL-dollar columns stored (including float-noise values such as
 * 0.1 + 0.2); after 035 the adapter must publish the same dollars.
 */

const MIGRATIONS = path.join(__dirname, '../../../../migrations/sqlite');
const NOISY = 0.1 + 0.2; // 0.30000000000000004, what float arithmetic can leave behind

function applyMigrations(db: Database.Database, from: number, to: number): void {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => {
      const version = parseInt(f.split('_')[0], 10);
      return version >= from && version <= to;
    });
  for (const file of files) db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

describeSqlite('migration 035 (money to integer cents) on SQLite', () => {
  let dir: string;
  let filename: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-money035-'));
    filename = path.join(dir, 'test.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('publishes the same dollars before and after the migration', async () => {
    if (!available) return;
    const db = new Database(filename);
    db.pragma('foreign_keys = ON');
    applyMigrations(db, 1, 34);

    db.prepare('INSERT INTO products (id, name, category, base_price) VALUES (?, ?, ?, ?)').run('p1', 'Tea', 'Drinks', 19.99);
    db.prepare('INSERT INTO product_variants (id, product_id, price_override, price_delta, stock) VALUES (?, ?, ?, ?, 5)').run('v1', 'p1', 12.5, null);
    db.prepare('INSERT INTO services (id, name, category, base_price) VALUES (?, ?, ?, ?)').run('s1', 'Install', 'Labor', 45.1);
    db.prepare('INSERT INTO services (id, name, category, base_price) VALUES (?, ?, ?, ?)').run('s2', 'Quote only', 'Labor', null);
    db.prepare(
      `INSERT INTO orders (id, created_at, subtotal, discount_total, tax_total, total, payment_method, amount_tendered, change_given)
       VALUES ('o1', 1000, ?, 0.1, 0.07, 0.37, 'Cash', 20, 19.63)`
    ).run(NOISY);
    db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, variant_id, name_snapshot, quantity, unit_price, line_discount, line_total)
       VALUES ('i1', 'o1', 'p1', 'v1', 'Tea', 1, ?, 0, ?)`
    ).run(NOISY, NOISY);
    db.prepare("INSERT INTO payments (id, order_id, method, amount, created_at) VALUES ('pay1', 'o1', 'cash', 0.37, 1000)").run();

    applyMigrations(db, 35, 35);
    db.close();

    const { SQLiteAdapter } = await import('../SQLiteAdapter');
    const adapter = new SQLiteAdapter({ filename });
    try {
      const order = (await adapter.getOrderById('o1')) as Record<string, any>;
      expect(order.subtotal).toBe(0.3);
      expect(order.discountTotal).toBe(0.1);
      expect(order.taxTotal).toBe(0.07);
      expect(order.total).toBe(0.37);
      expect(order.amountTendered).toBe(20);
      expect(order.changeGiven).toBe(19.63);
      expect(order.items[0]).toMatchObject({ unitPrice: 0.3, lineDiscount: 0, lineTotal: 0.3 });
      expect(order.payments[0].amount).toBe(0.37);

      const { products } = await adapter.getAllProducts({});
      expect(products[0].basePrice).toBe(19.99);
      expect(products[0].variants[0]).toMatchObject({ priceOverride: 12.5, priceDelta: null });

      const services = await adapter.getAllServices();
      expect(services.find((s) => s.id === 's1')?.basePrice).toBe(45.1);
      expect(services.find((s) => s.id === 's2')?.basePrice).toBeNull();
    } finally {
      adapter.close();
    }
  });
});
