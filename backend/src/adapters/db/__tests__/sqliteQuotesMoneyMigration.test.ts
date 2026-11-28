import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { available, describeSqlite } from './sqliteHarness';

/**
 * T-46 golden test. A database at migration 036 holds the quote, discount,
 * loyalty and archive money as REAL dollars (a percent promo and a fixed promo,
 * an employee discount with a monthly cap, an archived customer's history);
 * after 037 the adapter must publish the same dollars and percents.
 */

const MIGRATIONS = path.join(__dirname, '../../../../migrations/sqlite');

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

describeSqlite('migration 037 (quotes, discounts, archive money to integer cents) on SQLite', () => {
  let dir: string;
  let filename: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-money037-'));
    filename = path.join(dir, 'test.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('publishes the same dollars and percents before and after the migration', async () => {
    if (!available) return;
    const db = new Database(filename);
    db.pragma('foreign_keys = ON');
    applyMigrations(db, 1, 36);

    db.prepare("INSERT INTO customers (id, name, email) VALUES ('c1', 'Ada', 'ada@example.com')").run();
    db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES ('u1', 'staff@example.com', 'x', 'Staff')").run();
    db.prepare("INSERT INTO services (id, name, category) VALUES ('s1', 'Install', 'Labor')").run();
    db.prepare(
      "INSERT INTO quotes (id, customer_id, status, subtotal, tax_total, total, created_at) VALUES ('q1', 'c1', 'sent', 80.1, 6.41, 86.51, 1000)"
    ).run();
    db.prepare(
      "INSERT INTO quote_items (id, quote_id, service_id, description, quantity, unit_price, line_total) VALUES ('qi1', 'q1', 's1', 'Bench', 2.5, 32.04, 80.1)"
    ).run();

    db.prepare(
      `INSERT INTO discount_types (id, name, code, discount_type, discount_value, min_purchase, max_discount, approval_threshold)
       VALUES ('d-pct', 'Senior', 'SENIOR', 'percentage', 12.5, 0, 5.25, 40.1),
              ('d-fix', 'Five off', 'FIVE', 'fixed', 5, 20, NULL, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO promo_codes (id, code, name, discount_type, discount_value, min_purchase, max_discount, starts_at)
       VALUES ('p-pct', 'SAVE15', 'Save 15', 'percentage', 15, 30.3, 10, 1),
              ('p-fix', 'TAKE7', 'Take 7.50', 'fixed', 7.5, 0, NULL, 1)`
    ).run();
    db.prepare(
      `INSERT INTO employee_discounts (id, user_id, discount_percentage, max_discount_amount, current_month_usage, requires_manager_approval_above)
       VALUES ('e1', 'u1', 10, 100.1, 33.3, 50)`
    ).run();
    db.prepare(
      `INSERT INTO discount_usage (id, discount_source, discount_type, discount_value, discount_amount)
       VALUES ('du1', 'promo_code', 'percentage', 12.5, 10.01), ('du2', 'manual', 'fixed', 5, 5)`
    ).run();

    db.prepare("INSERT INTO loyalty_programs (id, name) VALUES ('lp1', 'Points')").run();
    db.prepare("INSERT INTO customer_loyalty (id, customer_id, program_id) VALUES ('cl1', 'c1', 'lp1')").run();
    db.prepare(
      "INSERT INTO loyalty_transactions (id, customer_loyalty_id, transaction_type, points, order_total, discount_amount) VALUES ('lt1', 'cl1', 'redeem', -100, 45.45, 1)"
    ).run();

    // History already archived before the migration.
    db.prepare(
      "INSERT INTO archived_quotes (id, customer_id, subtotal, tax, total) VALUES ('aq0', 'gone', 10.1, 0.81, 10.91)"
    ).run();
    db.prepare(
      "INSERT INTO archived_orders (id, customer_id, subtotal, tax, discount, total) VALUES ('ao0', 'gone', 20.2, 1.62, 2.02, 19.8)"
    ).run();

    applyMigrations(db, 37, 37);

    const archivedQuote = db.prepare("SELECT * FROM archived_quotes WHERE id = 'aq0'").get() as Record<string, number>;
    expect(archivedQuote).toMatchObject({ subtotal_cents: 1010, tax_cents: 81, total_cents: 1091 });
    const archivedOrder = db.prepare("SELECT * FROM archived_orders WHERE id = 'ao0'").get() as Record<string, number>;
    expect(archivedOrder).toMatchObject({ subtotal_cents: 2020, tax_cents: 162, discount_cents: 202, total_cents: 1980 });
    const loyalty = db.prepare("SELECT * FROM loyalty_transactions WHERE id = 'lt1'").get() as Record<string, number>;
    expect(loyalty).toMatchObject({ order_total_cents: 4545, discount_amount_cents: 100 });
    db.close();

    const { SQLiteAdapter } = await import('../SQLiteAdapter');
    const adapter = new SQLiteAdapter({ filename });
    try {
      const quote = (await adapter.getQuoteById('q1')) as Record<string, any>;
      expect(quote).toMatchObject({ subtotal: 80.1, taxTotal: 6.41, total: 86.51 });
      expect(quote.items[0]).toMatchObject({ quantity: 2.5, unitPrice: 32.04, lineTotal: 80.1 });

      const types = await adapter.getAllDiscountTypes();
      expect(types.find((t) => t.id === 'd-pct')).toMatchObject({
        discountValue: 12.5,
        minPurchase: 0,
        maxDiscount: 5.25,
        approvalThreshold: 40.1,
      });
      expect(types.find((t) => t.id === 'd-fix')).toMatchObject({
        discountValue: 5,
        minPurchase: 20,
        maxDiscount: null,
        approvalThreshold: null,
      });

      expect(await adapter.getPromoCodeById('p-pct')).toMatchObject({ discountValue: 15, minPurchase: 30.3, maxDiscount: 10 });
      expect(await adapter.getPromoCodeById('p-fix')).toMatchObject({ discountValue: 7.5, minPurchase: 0, maxDiscount: null });

      expect(await adapter.getEmployeeDiscountByUser('u1')).toMatchObject({
        discountPercentage: 10,
        maxDiscountAmount: 100.1,
        currentMonthUsage: 33.3,
        requiresManagerApprovalAbove: 50,
      });

      const usage = await adapter.getDiscountUsage({});
      expect(usage.find((u) => u.id === 'du1')).toMatchObject({ discountValue: 12.5, discountAmount: 10.01 });
      expect(usage.find((u) => u.id === 'du2')).toMatchObject({ discountValue: 5, discountAmount: 5 });
      expect(await adapter.getDiscountStats()).toMatchObject({ totalDiscountAmount: 15.01, promoCodeAmount: 10.01, manualDiscountAmount: 5 });

      // New writes round trip too, and the archive copies cents to cents.
      const created = await adapter.createPromoCode({
        code: 'NEW', name: 'New', discountType: 'percentage', discountValue: 12.5,
        minPurchase: 19.99, maxDiscount: 3.33, startsAt: 1,
      });
      expect(created).toMatchObject({ discountValue: 12.5, minPurchase: 19.99, maxDiscount: 3.33 });
      const logged = await adapter.logDiscountUsage({ discountSource: 'manual', discountType: 'fixed', discountValue: 2.5, discountAmount: 2.5 });
      expect(logged).toMatchObject({ discount_value: 2.5, discount_amount: 2.5 });

      const updated = (await adapter.updateQuote('q1', { total: 90.25, items: [{ serviceId: 's1', description: 'Bench', quantity: 1, unitPrice: 90.25, lineTotal: 90.25 }] })) as Record<string, any>;
      expect(updated).toMatchObject({ subtotal: 80.1, total: 90.25 });
      expect(updated.items[0]).toMatchObject({ unitPrice: 90.25 });

      expect(await adapter.archiveCustomer('c1', 'u1', 'test')).toBe(true);
    } finally {
      adapter.close();
    }

    const check = new Database(filename);
    try {
      const archived = check.prepare("SELECT * FROM archived_quotes WHERE id = 'q1'").get() as Record<string, any>;
      expect(archived).toMatchObject({ subtotal_cents: 8010, tax_cents: 641, total_cents: 9025 });
      expect(JSON.parse(archived.items)[0]).toMatchObject({ unit_price_cents: 9025, line_total_cents: 9025 });
    } finally {
      check.close();
    }
  });
});
