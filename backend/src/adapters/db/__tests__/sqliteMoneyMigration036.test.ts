import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { available, describeSqlite } from './sqliteHarness';

/**
 * T-45 golden test. A database at migration 035 holds the returns, store credit
 * and drawer money the old REAL-dollar columns stored (including float-noise
 * values such as 0.1 + 0.2); after 036 the adapter must publish the same dollars,
 * and redeeming credit / closing a drawer must work in integer cents.
 */

const MIGRATIONS = path.join(__dirname, '../../../../migrations/sqlite');
const NOISY = 0.1 + 0.2; // 0.30000000000000004
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

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

describeSqlite('migration 036 (returns, store credit, drawer to integer cents) on SQLite', () => {
  let dir: string;
  let filename: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-money036-'));
    filename = path.join(dir, 'test.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('publishes the same dollars, then redeems credit and closes a drawer in cents', async () => {
    if (!available) return;
    const db = new Database(filename);
    db.pragma('foreign_keys = ON');
    applyMigrations(db, 1, 35);

    db.prepare("INSERT INTO cash_drawer_sessions (id, opened_at, opening_float, status) VALUES ('s1', 1000, 100.1, 'open')").run();
    db.prepare(
      `INSERT INTO orders (id, created_at, subtotal_cents, total_cents, payment_method, amount_tendered_cents, change_given_cents, drawer_session_id)
       VALUES ('o1', 1000, 1999, 1999, 'Cash', 2000, 1, 's1')`
    ).run();
    db.prepare(
      `INSERT INTO returns (id, original_order_id, return_number, status, refund_method, subtotal, tax_total, total, store_credit_amount, restocking_fee)
       VALUES ('r1', 'o1', 'RET-1', 'completed', 'store_credit', ?, 0.07, 0.37, 5.1, 0.05)`
    ).run(NOISY);
    db.prepare(
      `INSERT INTO return_items (id, return_id, product_id, name_snapshot, original_quantity, return_quantity, unit_price, line_total)
       VALUES ('ri1', 'r1', 'p1', 'Tea', 1, 1, ?, ?)`
    ).run(NOISY, NOISY);
    db.prepare("INSERT INTO refund_transactions (id, return_id, order_id, transaction_type, amount, payment_method) VALUES ('rt1', 'r1', 'o1', 'refund', 0.37, 'cash')").run();
    db.prepare("INSERT INTO store_credits (id, code, original_amount, remaining_amount) VALUES ('sc1', 'SC1', 10.1, 7.25)").run();
    db.prepare('UPDATE organizations SET drawer_variance_threshold = 5.25').run();

    applyMigrations(db, 36, 36);
    db.close();

    const { SQLiteAdapter } = await import('../SQLiteAdapter');
    const adapter = new SQLiteAdapter({ filename });
    try {
      const ret = (await adapter.getReturnById('r1')) as Record<string, any>;
      expect(ret).toMatchObject({ subtotal: 0.3, taxTotal: 0.07, total: 0.37, storeCreditAmount: 5.1, restockingFee: 0.05, originalOrderTotal: 19.99 });
      expect(ret.items[0]).toMatchObject({ unitPrice: 0.3, lineTotal: 0.3 });
      expect(await adapter.getReturnStats()).toMatchObject({ totalRefunded: 0.37, totalStoreCredits: 5.1 });

      // Store credit: issue (cents on write), then redeem part and the rest.
      const issued = await adapter.createStoreCredit({ code: 'SC2', originalAmount: 12.34, remainingAmount: 12.34 });
      expect(issued).toMatchObject({ originalAmount: 12.34, remainingAmount: 12.34 });
      expect(await adapter.getStoreCreditByCode('SC1')).toMatchObject({ originalAmount: 10.1, remainingAmount: 7.25 });
      expect(await adapter.redeemStoreCredit('SC1', 7.26)).toBeNull();
      expect(await adapter.redeemStoreCredit('SC1', 2.25)).toMatchObject({ remainingAmount: 5, status: 'active' });
      expect(await adapter.redeemStoreCredit('SC1', 5)).toMatchObject({ remainingAmount: 0, status: 'used' });

      // Drawer: expected = float + cash tendered - change, all in cents.
      expect(await adapter.getOrganizationDrawerVarianceThreshold(DEFAULT_ORG)).toBe(5.25);
      const expected = await adapter.getExpectedDrawerCash('s1');
      expect(expected).toBe(120.09);
      const closed = await adapter.closeDrawerSession('s1', 119.84, expected);
      expect(closed).toMatchObject({ openingFloat: 100.1, expectedCash: 120.09, countedCash: 119.84, variance: -0.25 });
    } finally {
      adapter.close();
    }
  });
});
