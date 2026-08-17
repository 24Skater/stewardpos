import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, type Harness } from './harness';

/**
 * Migration 015's constraints, against a real Postgres.
 *
 * `migrator.test.ts` only exercises SQLite — its shared handle is opened
 * `{ readonly: true }`, so nothing there can INSERT — and the SQLite and
 * Postgres migration files, though semantically paired, are two independent
 * SQL documents. Running migration 015 proves it doesn't have a syntax
 * error; it proves nothing about whether the constraints it declares
 * actually hold. These tests write real rows against the real Postgres
 * schema and confirm the database itself refuses what it's supposed to.
 *
 * No `PostgresAdapter` methods exist yet for registers — that lands in a
 * later task — so these go through `h.query` directly, the same way
 * `harness.ts` lets other suites arrange state the adapter has no method
 * for.
 */

let h: Harness;
const mark = `reg${Math.random().toString(36).slice(2, 8)}`;

let orgAId: string;
let orgBId: string;
let locAId: string;
let locASiblingId: string;
let locBId: string;

async function makeOrg(label: string): Promise<string> {
  const { rows } = await h.query(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [`${mark} ${label}`, `${mark}-${label}`]
  );
  return String(rows[0].id);
}

async function makeLocation(orgId: string, label: string): Promise<string> {
  const { rows } = await h.query(
    'INSERT INTO locations (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [orgId, `${mark} ${label}`, `${mark}-${label}`]
  );
  return String(rows[0].id);
}

/**
 * Removes everything this file creates, ordered by dependency: registers
 * before locations (the composite FK), locations before organizations.
 * Matched on `mark` rather than a TRUNCATE, since this database is shared
 * with whatever else the suite is doing.
 */
async function cleanup(): Promise<void> {
  await h.query('DELETE FROM registers WHERE display_code LIKE $1 OR name LIKE $1', [`${mark}%`]);
  await h.query('DELETE FROM locations WHERE slug LIKE $1', [`${mark}%`]);
  await h.query('DELETE FROM organizations WHERE slug LIKE $1', [`${mark}%`]);
}

beforeAll(async () => {
  h = await connect();
}, 30_000);

beforeEach(async () => {
  await cleanup();

  orgAId = await makeOrg('org-a');
  orgBId = await makeOrg('org-b');
  locAId = await makeLocation(orgAId, 'loc-a');
  locASiblingId = await makeLocation(orgAId, 'loc-a-sibling');
  locBId = await makeLocation(orgBId, 'loc-b');
});

afterAll(async () => {
  await cleanup();
  await h.close();
});

describe('idx_registers_display_code', () => {
  it('rejects a duplicate display_code within one org, but accepts it under a different org', async () => {
    const code = `${mark}-DUP-01`;

    await h.query(
      `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
       VALUES ($1, $2, 'First', 1, $3)`,
      [orgAId, locAId, code]
    );

    // Same org, same code, a different location even — still one identity.
    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Second', 2, $3)`,
        [orgAId, locASiblingId, code]
      )
    ).rejects.toThrow();

    // A different org operating a till named the same code is not a
    // collision — display_code is org-scoped, not global.
    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Third', 1, $3)`,
        [orgBId, locBId, code]
      )
    ).resolves.toBeDefined();
  });
});

describe('idx_registers_loc_number', () => {
  it('rejects a duplicate register_number within one location, but accepts it at a sibling location', async () => {
    // This is the per-location numbering decision the migration exists to
    // support: "Register 1" is not a single global identity.
    await h.query(
      `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
       VALUES ($1, $2, 'First', 1, $3)`,
      [orgAId, locAId, `${mark}-A-01`]
    );

    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Second', 1, $3)`,
        [orgAId, locAId, `${mark}-A-02`]
      )
    ).rejects.toThrow();

    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Third', 1, $3)`,
        [orgAId, locASiblingId, `${mark}-A-03`]
      )
    ).resolves.toBeDefined();
  });
});

describe('composite FK (location_id, org_id)', () => {
  it('rejects a register whose org disagrees with its location\'s org', async () => {
    // locAId belongs to orgAId. Claiming orgBId here would leak orgAId's
    // location address into orgBId's register list, and orphan
    // display_code's uniqueness onto an org the register doesn't operate in.
    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Mismatched', 1, $3)`,
        [orgBId, locAId, `${mark}-MISMATCH-01`]
      )
    ).rejects.toThrow();
  });

  it('accepts a register whose org matches its location\'s org', async () => {
    await expect(
      h.query(
        `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
         VALUES ($1, $2, 'Matched', 1, $3)`,
        [orgAId, locAId, `${mark}-MATCH-01`]
      )
    ).resolves.toBeDefined();
  });
});

describe('register defaults', () => {
  it('gives a minimally-specified register a fully capable, pending posture', async () => {
    const { rows } = await h.query(
      `INSERT INTO registers (org_id, location_id, name, register_number, display_code)
       VALUES ($1, $2, 'Bare', 1, $3)
       RETURNING status, has_cash_drawer, accepts_cash, can_refund,
                 can_open_drawer_no_sale, require_sign_in, idle_lock_seconds, type`,
      [orgAId, locAId, `${mark}-BARE-01`]
    );

    expect(rows[0]).toMatchObject({
      status: 'pending',
      has_cash_drawer: true,
      accepts_cash: true,
      can_refund: true,
      can_open_drawer_no_sale: false,
      require_sign_in: false,
      idle_lock_seconds: 300,
      type: 'fixed',
    });
  });
});
