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
 * Removes everything this file creates, ordered by dependency:
 * cash_drawer_sessions and orders before registers (both FK to it),
 * registers before locations (the composite FK), locations before
 * organizations. Matched on `mark` rather than a TRUNCATE, since this
 * database is shared with whatever else the suite is doing.
 */
async function cleanup(): Promise<void> {
  await h.query(
    `DELETE FROM cash_drawer_sessions
     WHERE register_id IN (SELECT id FROM registers WHERE display_code LIKE $1 OR name LIKE $1)`,
    [`${mark}%`]
  );
  await h.query('DELETE FROM orders WHERE customer_email LIKE $1', [`${mark}%`]);
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

/**
 * `PostgresAdapter` register/location methods, added in this task.
 *
 * Everything above this line predates the adapter methods and goes through
 * `h.query` directly. These go through `h.adapter` instead, since that is
 * the surface the (not-yet-written) service layer will actually call.
 */
describe('createRegister', () => {
  it('rejects a duplicate register_number at one location, but accepts it at a sibling location', async () => {
    const first = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locAId,
      name: `${mark} First`,
      register_number: 5,
      display_code: `${mark}-NUM-01`,
    });
    expect(first).not.toBe('duplicate_number');

    const dup = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locAId,
      name: `${mark} Second`,
      register_number: 5,
      display_code: `${mark}-NUM-02`,
    });
    expect(dup).toBe('duplicate_number');

    const sibling = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locASiblingId,
      name: `${mark} Third`,
      register_number: 5,
      display_code: `${mark}-NUM-03`,
    });
    expect(sibling).not.toBe('duplicate_number');
    expect(sibling).not.toBe('bad_location');
  });

  it('rejects a duplicate display_code within one org, but accepts it under a different org', async () => {
    const code = `${mark}-CODE-01`;

    const first = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locAId,
      name: `${mark} A`,
      register_number: 11,
      display_code: code,
    });
    expect(first).not.toBe('duplicate_code');

    const dup = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locASiblingId,
      name: `${mark} B`,
      register_number: 12,
      display_code: code,
    });
    expect(dup).toBe('duplicate_code');

    const otherOrg = await h.adapter.createRegister({
      org_id: orgBId,
      location_id: locBId,
      name: `${mark} C`,
      register_number: 1,
      display_code: code,
    });
    expect(otherOrg).not.toBe('duplicate_code');
  });

  it('rejects a location that belongs to a different org', async () => {
    const result = await h.adapter.createRegister({
      org_id: orgBId,
      location_id: locAId, // locAId belongs to orgAId
      name: `${mark} Mismatch`,
      register_number: 1,
      display_code: `${mark}-BADLOC-01`,
    });
    expect(result).toBe('bad_location');
  });
});

describe('mapRegister (via createRegister)', () => {
  it('returns real booleans, not 0/1, and a finite createdAt with a null (not NaN) lastSeenAt', async () => {
    const reg = await h.adapter.createRegister({
      org_id: orgAId,
      location_id: locAId,
      name: `${mark} Bool`,
      register_number: 21,
      display_code: `${mark}-BOOL-01`,
    });
    if (typeof reg === 'string') throw new Error(`expected a register row, got ${reg}`);

    // The regression this guards against: SQLite's adapter returns 0/1 for
    // these columns unless explicitly coerced, which would make the same
    // register serialize differently per environment.
    expect(typeof reg.hasCashDrawer).toBe('boolean');
    expect(typeof reg.acceptsCash).toBe('boolean');
    expect(typeof reg.canRefund).toBe('boolean');
    expect(typeof reg.canOpenDrawerNoSale).toBe('boolean');
    expect(typeof reg.requireSignIn).toBe('boolean');
    expect(reg.canOpenDrawerNoSale).toBe(false);

    expect(Number.isFinite(reg.createdAt)).toBe(true);
    expect(reg.lastSeenAt).toBeNull();
  });
});

describe('countRegistersForCap', () => {
  it('counts pending, active and disabled registers, but excludes retired', async () => {
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} P`, register_number: 31,
      display_code: `${mark}-CAP-01`, status: 'pending',
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Act`, register_number: 32,
      display_code: `${mark}-CAP-02`, status: 'active',
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Dis`, register_number: 33,
      display_code: `${mark}-CAP-03`, status: 'disabled',
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Ret`, register_number: 34,
      display_code: `${mark}-CAP-04`, status: 'retired',
    });

    const count = await h.adapter.countRegistersForCap(orgAId);
    expect(count).toBe(3);
  });
});

describe('getUsedRegisterNumbers', () => {
  it('includes a retired register\'s number, since retired numbers are never released for reuse', async () => {
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Live`, register_number: 41,
      display_code: `${mark}-USED-01`,
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Dead`, register_number: 42,
      display_code: `${mark}-USED-02`, status: 'retired',
    });

    const numbers = await h.adapter.getUsedRegisterNumbers(locAId);
    expect(numbers).toEqual([41, 42]);
  });
});

describe('updateRegister', () => {
  it('ignores attempts to change org_id, location_id and register_number', async () => {
    const created = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Orig`, register_number: 51,
      display_code: `${mark}-UPD-01`,
    });
    if (typeof created === 'string') throw new Error(`expected a register row, got ${created}`);

    const updated = await h.adapter.updateRegister(created.id, {
      org_id: orgBId,
      location_id: locBId,
      register_number: 999,
      name: `${mark} Renamed`,
    });
    if (updated === null || updated === 'duplicate_code') {
      throw new Error(`expected a register row, got ${updated}`);
    }

    expect(updated.orgId).toBe(orgAId);
    expect(updated.locationId).toBe(locAId);
    expect(updated.registerNumber).toBe(51);
    expect(updated.name).toBe(`${mark} Renamed`);
  });

  /**
   * The regression this whole change exists to fix: COALESCE cannot tell
   * "clear this" from "leave this alone" once both arrive as a bound NULL.
   * An admin unbinding a dead card reader sends `terminal_provider: null`
   * and `terminal_device_id: null` and expects the register to actually
   * come back unbound.
   */
  it('clears terminal_provider and terminal_device_id when sent explicit null (card-reader unbind)', async () => {
    const created = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Bound`, register_number: 52,
      display_code: `${mark}-UPD-02`, terminal_provider: 'square', terminal_device_id: 'reader-123',
    });
    if (typeof created === 'string') throw new Error(`expected a register row, got ${created}`);
    expect(created.terminalProvider).toBe('square');
    expect(created.terminalDeviceId).toBe('reader-123');

    const updated = await h.adapter.updateRegister(created.id, {
      terminal_provider: null,
      terminal_device_id: null,
    });
    if (updated === null || updated === 'duplicate_code') {
      throw new Error(`expected a register row, got ${updated}`);
    }

    expect(updated.terminalProvider).toBeNull();
    expect(updated.terminalDeviceId).toBeNull();
  });

  it('clears placement when sent explicit null, but leaves it untouched when the key is omitted', async () => {
    const created = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Placed`, register_number: 53,
      display_code: `${mark}-UPD-03`, placement: '1st floor coffee shop',
    });
    if (typeof created === 'string') throw new Error(`expected a register row, got ${created}`);
    expect(created.placement).toBe('1st floor coffee shop');

    // Omitting the key entirely must leave the existing value alone — the
    // behavior COALESCE gave for free, which the dynamic SET clause must
    // not regress.
    const untouched = await h.adapter.updateRegister(created.id, { name: `${mark} Placed Renamed` });
    if (untouched === null || untouched === 'duplicate_code') {
      throw new Error(`expected a register row, got ${untouched}`);
    }
    expect(untouched.placement).toBe('1st floor coffee shop');

    const cleared = await h.adapter.updateRegister(created.id, { placement: null });
    if (cleared === null || cleared === 'duplicate_code') {
      throw new Error(`expected a register row, got ${cleared}`);
    }
    expect(cleared.placement).toBeNull();
  });

  it('does not null out name when sent explicit null (NOT NULL column guard)', async () => {
    const created = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Guarded`, register_number: 54,
      display_code: `${mark}-UPD-04`,
    });
    if (typeof created === 'string') throw new Error(`expected a register row, got ${created}`);

    const updated = await h.adapter.updateRegister(created.id, { name: null, placement: 'Kiosk' });
    if (updated === null || updated === 'duplicate_code') {
      throw new Error(`expected a register row, got ${updated}`);
    }

    // name is NOT NULL: the explicit null is refused, not written.
    expect(updated.name).toBe(`${mark} Guarded`);
    // The rest of the payload is still applied.
    expect(updated.placement).toBe('Kiosk');
  });
});

describe('updateLocation', () => {
  it('clears address when sent explicit null, but leaves it untouched when the key is omitted', async () => {
    const created = await h.adapter.createLocation({
      org_id: orgAId, name: `${mark} With Address`, slug: `${mark}-with-address`,
      address: '123 Main St',
    });
    if (typeof created === 'string') throw new Error(`expected a location row, got ${created}`);
    expect(created.address).toBe('123 Main St');

    const untouched = await h.adapter.updateLocation(created.id, { name: `${mark} Renamed` });
    if (untouched === null || untouched === 'duplicate_slug') {
      throw new Error(`expected a location row, got ${untouched}`);
    }
    expect(untouched.address).toBe('123 Main St');

    const cleared = await h.adapter.updateLocation(created.id, { address: null });
    if (cleared === null || cleared === 'duplicate_slug') {
      throw new Error(`expected a location row, got ${cleared}`);
    }
    expect(cleared.address).toBeNull();
  });
});

describe('getRegisters', () => {
  it('filters by locationId and by status, and populates locationName', async () => {
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Loc A Active`, register_number: 61,
      display_code: `${mark}-FILT-01`, status: 'active',
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} Loc A Pending`, register_number: 62,
      display_code: `${mark}-FILT-02`, status: 'pending',
    });
    await h.adapter.createRegister({
      org_id: orgAId, location_id: locASiblingId, name: `${mark} Loc Sibling Active`, register_number: 61,
      display_code: `${mark}-FILT-03`, status: 'active',
    });

    const allForOrg = await h.adapter.getRegisters({ orgId: orgAId });
    expect(allForOrg.length).toBe(3);
    expect(allForOrg.every((r) => typeof r.locationName === 'string')).toBe(true);

    const locOnly = await h.adapter.getRegisters({ orgId: orgAId, locationId: locAId });
    expect(locOnly.length).toBe(2);
    expect(locOnly.every((r) => r.locationId === locAId)).toBe(true);

    const statusOnly = await h.adapter.getRegisters({ orgId: orgAId, status: 'active' });
    expect(statusOnly.length).toBe(2);
    expect(statusOnly.every((r) => r.status === 'active')).toBe(true);
  });
});

/**
 * Migration 016's constraints, against a real Postgres.
 *
 * 011's `idx_drawer_one_open` was a single global partial unique index on
 * `(status)` — at most one open drawer in the *entire installation*,
 * regardless of which register it was on. That made running more than one
 * register at a time physically impossible: Register 2 could not open a
 * drawer while Register 1 had one open. 016 replaces it with
 * `idx_drawer_one_open_per_register` on `(register_id, status)`, which is
 * the behaviour these tests exist to prove actually holds against a real
 * database, not just a review of the SQL.
 */
describe('idx_drawer_one_open_per_register (016)', () => {
  it('lets two different registers each hold an open drawer session simultaneously', async () => {
    const regA = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} DrawerA`, register_number: 71,
      display_code: `${mark}-DRAWER-01`,
    });
    const regB = await h.adapter.createRegister({
      org_id: orgAId, location_id: locASiblingId, name: `${mark} DrawerB`, register_number: 71,
      display_code: `${mark}-DRAWER-02`,
    });
    if (typeof regA === 'string' || typeof regB === 'string') {
      throw new Error(`expected register rows, got ${regA} / ${regB}`);
    }

    // Under 011's global constraint, the second of these two inserts would
    // have been rejected outright. Under 016 they're on different
    // registers, so both succeed.
    await expect(
      h.query(
        `INSERT INTO cash_drawer_sessions (register_id, opening_float, status) VALUES ($1, 0, 'open')`,
        [regA.id]
      )
    ).resolves.toBeDefined();

    await expect(
      h.query(
        `INSERT INTO cash_drawer_sessions (register_id, opening_float, status) VALUES ($1, 0, 'open')`,
        [regB.id]
      )
    ).resolves.toBeDefined();
  });

  it('still rejects a second open session on the SAME register', async () => {
    const reg = await h.adapter.createRegister({
      org_id: orgAId, location_id: locAId, name: `${mark} DrawerSame`, register_number: 72,
      display_code: `${mark}-DRAWER-03`,
    });
    if (typeof reg === 'string') throw new Error(`expected a register row, got ${reg}`);

    await h.query(
      `INSERT INTO cash_drawer_sessions (register_id, opening_float, status) VALUES ($1, 0, 'open')`,
      [reg.id]
    );

    // Same register, still open: the per-register uniqueness must still
    // fire, or two sessions could both claim to own the same till at once.
    await expect(
      h.query(
        `INSERT INTO cash_drawer_sessions (register_id, opening_float, status) VALUES ($1, 0, 'open')`,
        [reg.id]
      )
    ).rejects.toThrow();
  });
});

/**
 * The cross-tenant misattribution risk 016's backfill exists to avoid: a
 * naive backfill pointing every historical row at the one register 015
 * seeded would have attributed org B's entire order history to org A's
 * (or the default org's) till.
 *
 * Migration 016 already ran against this database once, gated by
 * `schema_migrations` — it cannot be re-run to prove this against orgAId /
 * orgBId, which are created fresh per test and did not exist when it ran.
 * What CAN be proven live is the invariant its backfill logic is supposed to
 * guarantee: re-executing that exact backfill UPDATE (copied verbatim from
 * `016_register_attribution.sql`, scoped with `AND id = $1` so it cannot
 * touch any other row in this shared database) resolves a row to its OWN
 * org's register — never the default org's, and never a sibling org's.
 */
describe('per-org register backfill invariant (016)', () => {
  it("attributes a new organisation's order to its OWN register, not the default org's", async () => {
    const register = await h.adapter.createRegister({
      org_id: orgBId, location_id: locBId, name: `${mark} OrgBReg`, register_number: 81,
      display_code: `${mark}-ORGB-01`,
    });
    if (typeof register === 'string') throw new Error(`expected a register row, got ${register}`);

    const { rows } = await h.query(
      `INSERT INTO orders (subtotal, total, payment_method, org_id, customer_email)
       VALUES (1, 1, 'card', $1, $2) RETURNING id`,
      [orgBId, `${mark}@example.com`]
    );
    const orderId = String(rows[0].id);

    await h.query(
      `UPDATE orders
       SET register_id = (
         SELECT r.id FROM registers r
         WHERE r.org_id = COALESCE(orders.org_id, '00000000-0000-0000-0000-000000000001')
         ORDER BY r.register_number ASC, r.created_at ASC, r.id ASC
         LIMIT 1
       )
       WHERE register_id IS NULL AND id = $1`,
      [orderId]
    );

    const { rows: after } = await h.query('SELECT register_id FROM orders WHERE id = $1', [orderId]);
    expect(after[0].register_id).toBe(register.id);
    // The default org's 015-seeded register — the value a hardcoded-id
    // backfill would have wrongly assigned to every org's history.
    expect(after[0].register_id).not.toBe('00000000-0000-0000-0000-0000000000b1');
  });
});

describe('malformed ids', () => {
  it('reports a non-UUID user id as not found rather than raising', async () => {
    // Postgres raises 22P02 on a bad UUID cast, which surfaced to the route as
    // a 500 with a stack trace where SQLite - which stores ids as TEXT - simply
    // matches nothing and 404s. A user's typo in a URL is not a server fault,
    // and the two adapters have to agree.
    await expect(h.adapter.getUserById('not-a-uuid')).resolves.toBeNull();
    await expect(
      h.adapter.setUserPin('not-a-uuid', { pinHash: null, pinSetAt: null })
    ).resolves.toBeNull();
  });
});
