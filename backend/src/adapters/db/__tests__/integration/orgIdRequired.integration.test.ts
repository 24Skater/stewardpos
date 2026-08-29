import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Migration 026 — `org_id` NOT NULL, with a DEFAULT — against a real Postgres.
 *
 * Step 1 of the multi-tenant plan, and the step whose earlier documented form
 * would have taken the shop offline: not one of the forty-four INSERTs in the
 * adapters names `org_id`, so the constraint without the default rejects every
 * write the application makes.
 *
 * The rest of the integration suite is the real proof that this is safe — 379
 * tests exercising the actual adapter SQL against a schema carrying the
 * constraint. What this file adds is the *reason* those pass, stated directly,
 * so a future change that drops the DEFAULT fails here with an explanation
 * rather than somewhere else with a constraint violation.
 */
let h: Harness;
const mark = tag();

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/** The tables migration 014 gave an `org_id`, and 026 made it required on. */
const TENANT_TABLES = [
  'products', 'product_variants', 'orders', 'order_items', 'customers',
  'services', 'quotes', 'quote_items', 'discount_types', 'promo_codes',
  'returns', 'return_items', 'audit_logs', 'roles', 'users', 'settings',
  'categories', 'payments', 'store_credits', 'cash_drawer_sessions',
];

const customerIds: string[] = [];

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (customerIds.length > 0) {
    await h.query('DELETE FROM customers WHERE id = ANY($1)', [customerIds]);
  }
  await h.close();
});

describe('org_id is required', () => {
  it('is NOT NULL on every tenant-scoped table', async () => {
    const { rows } = await h.query(
      `SELECT table_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'org_id'
          AND table_name = ANY($1)`,
      [TENANT_TABLES]
    );

    // Guards the guard: a typo'd table list would make the loop below vacuous.
    expect(rows.length).toBe(TENANT_TABLES.length);

    const nullable = rows.filter((r) => r.is_nullable === 'YES').map((r) => r.table_name);
    expect(nullable).toEqual([]);
  });

  it('carries the default org as its DEFAULT on every one of them', async () => {
    const { rows } = await h.query(
      `SELECT table_name, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'org_id'
          AND table_name = ANY($1)`,
      [TENANT_TABLES]
    );

    const missing = rows
      .filter((r) => !String(r.column_default ?? '').includes(DEFAULT_ORG_ID))
      .map((r) => r.table_name);

    expect(
      missing,
      'org_id is NOT NULL here with no DEFAULT behind it. Every insert that does ' +
        'not name the column - which is all of them today - will fail. See ' +
        'migration 026 and docs/guides/multi-tenant.md step 1.'
    ).toEqual([]);
  });

  it('lets a write that says nothing about tenancy succeed', async () => {
    // The exact shape every adapter INSERT has today. This failing is what the
    // original runbook would have caused, in production, on every table at once.
    const { rows } = await h.query(
      'INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id, org_id',
      [`${mark} Blind Write`, `${mark}-blind@example.com`]
    );
    customerIds.push(String(rows[0].id));

    expect(rows[0].org_id).toBe(DEFAULT_ORG_ID);
  });

  it('lets an explicit org_id win over the default', async () => {
    // The default is scaffolding for the window before writes are scoped. It
    // must not override a caller that knows which tenant it is writing for, or
    // step 3 would silently file every row under the default org.
    const { rows } = await h.query(
      'INSERT INTO customers (name, email, org_id) VALUES ($1, $2, $3) RETURNING id, org_id',
      [`${mark} Explicit`, `${mark}-explicit@example.com`, DEFAULT_ORG_ID]
    );
    customerIds.push(String(rows[0].id));

    expect(rows[0].org_id).toBe(DEFAULT_ORG_ID);
  });

  it('refuses an explicit NULL, which is the constraint doing its job', async () => {
    // The DEFAULT only applies when the column is omitted. A write that names
    // org_id and passes null is a bug, and after this migration it says so
    // immediately rather than filing an untenanted row.
    await expect(
      h.query('INSERT INTO customers (name, email, org_id) VALUES ($1, $2, NULL)', [
        `${mark} Null`,
        `${mark}-null@example.com`,
      ])
    ).rejects.toThrow(/not-null constraint/i);
  });

  it('left no untenanted rows behind', async () => {
    // The backfill half. Any row predating the migration should now name the
    // default org rather than nothing.
    for (const table of TENANT_TABLES) {
      const { rows } = await h.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id IS NULL`);
      expect(rows[0].n, `${table} still has untenanted rows`).toBe(0);
    }
  });
});
