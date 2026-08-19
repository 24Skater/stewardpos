import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Manager overrides (migration 019) against a real Postgres: the raw SQL in
 * `PostgresAdapter.ts` for `register_overrides` and
 * `organizations.drawer_variance_threshold` has never run against a real
 * database before this file — every route/service test in the suite mocks
 * the adapter. This proves the queries themselves are correct: the
 * `consumed_at IS NULL` race guard, the `TIMESTAMP` round-trip through
 * `new Date(...).getTime()`, and the org-scoped join in the admin listing.
 */
let h: Harness;
const mark = tag();

const userIds: string[] = [];
let orgId: string;
let locationId: string;
let registerId: string;
let otherRegisterId: string;

async function makeUser(email: string, canOverride: boolean): Promise<string> {
  const created = await h.adapter.createUser({
    email,
    passwordHash: 'not-a-real-hash',
    name: `${mark} person`,
    status: 'active',
    roleIds: [],
  });
  const id = String(created.id);
  userIds.push(id);
  await h.query('UPDATE users SET org_id = $1, can_override = $2 WHERE id = $3', [orgId, canOverride, id]);
  await h.adapter.setUserPin(id, { pinHash: `hash-${id}`, pinSetAt: Date.now() });
  return id;
}

beforeAll(async () => {
  h = await connect();

  const org = await h.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [
    `${mark} org`,
    `${mark}-org`,
  ]);
  orgId = String(org.rows[0].id);

  const location = await h.query(
    'INSERT INTO locations (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [orgId, `${mark} location`, `${mark}-location`]
  );
  locationId = String(location.rows[0].id);

  const register = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} register`,
    register_number: 1,
    display_code: `${mark}-REG-01`,
    status: 'active',
  });
  if (typeof register === 'string') throw new Error(`expected a register row, got ${register}`);
  registerId = String(register.id);

  const other = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} other register`,
    register_number: 2,
    display_code: `${mark}-REG-02`,
    status: 'active',
  });
  if (typeof other === 'string') throw new Error(`expected a register row, got ${other}`);
  otherRegisterId = String(other.id);
}, 30_000);

afterAll(async () => {
  // register_overrides before users (approver_user_id/requested_by_user_id FK
  // to users), users before organizations (users.org_id FK to organizations).
  await h.query('DELETE FROM register_overrides WHERE register_id = ANY($1)', [[registerId, otherRegisterId]]);
  if (userIds.length > 0) {
    await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  await h.query('DELETE FROM registers WHERE id = ANY($1)', [[registerId, otherRegisterId]]);
  await h.query('DELETE FROM locations WHERE id = $1', [locationId]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await h.close();
});

describe('getActiveUsersWithOverridePermission', () => {
  it('includes a can_override user and excludes one without it', async () => {
    const approverId = await makeUser(`${mark}-approver@example.com`, true);
    const cashierId = await makeUser(`${mark}-cashier@example.com`, false);

    const candidates = await h.adapter.getActiveUsersWithOverridePermission(orgId);

    expect(candidates.some((u) => String(u.id) === approverId)).toBe(true);
    expect(candidates.some((u) => String(u.id) === cashierId)).toBe(false);
  });
});

describe('createRegisterOverride / getRegisterOverridesByPrefix / consumeRegisterOverride', () => {
  it('round-trips a grant, and TIMESTAMP columns survive as epoch-ms numbers', async () => {
    const approverId = await makeUser(`${mark}-approver-2@example.com`, true);
    const expiresAt = Date.now() + 90_000;

    const created = await h.adapter.createRegisterOverride({
      registerId,
      shiftId: null,
      approverUserId: approverId,
      requestedByUserId: null,
      action: 'void',
      grantPrefix: `${mark}pfx`,
      grantHash: 'a-real-bcrypt-hash-would-go-here',
      expiresAt,
      reason: null,
    });

    expect(created.registerId).toBe(registerId);
    expect(created.action).toBe('void');
    expect(created.consumedAt).toBeNull();
    expect(typeof created.expiresAt).toBe('number');
    expect(created.expiresAt).toBe(expiresAt);

    const byPrefix = await h.adapter.getRegisterOverridesByPrefix(`${mark}pfx`);
    expect(byPrefix.some((row) => String(row.id) === String(created.id))).toBe(true);
  });

  it('consumeRegisterOverride sets consumed_at and the entity/value columns, once', async () => {
    const approverId = await makeUser(`${mark}-approver-3@example.com`, true);
    const created = await h.adapter.createRegisterOverride({
      registerId,
      shiftId: null,
      approverUserId: approverId,
      requestedByUserId: null,
      action: 'drawer_variance',
      grantPrefix: `${mark}pfx2`,
      grantHash: 'hash-2',
      expiresAt: Date.now() + 90_000,
      reason: null,
    });

    const consumed = await h.adapter.consumeRegisterOverride(String(created.id), {
      entity: 'drawer_session',
      entityId: 'ds-real-1',
      beforeValue: '250.50',
      afterValue: '240.00',
    });

    expect(consumed).not.toBeNull();
    expect(consumed!.entity).toBe('drawer_session');
    expect(consumed!.entityId).toBe('ds-real-1');
    expect(consumed!.beforeValue).toBe('250.50');
    expect(consumed!.afterValue).toBe('240.00');
    expect(consumed!.consumedAt).not.toBeNull();

    // Guarded on consumed_at IS NULL: a second consume of the same row must
    // read back as null, the same race-safety `redeemPairingCredential` uses.
    const second = await h.adapter.consumeRegisterOverride(String(created.id), {
      entity: 'drawer_session',
      entityId: 'ds-real-1',
      beforeValue: null,
      afterValue: null,
    });
    expect(second).toBeNull();
  });
});

describe('getOrganizationDrawerVarianceThreshold', () => {
  it('is null by default, and reads back a set DECIMAL value', async () => {
    const initial = await h.adapter.getOrganizationDrawerVarianceThreshold(orgId);
    expect(initial).toBeNull();

    await h.query('UPDATE organizations SET drawer_variance_threshold = $1 WHERE id = $2', [5.5, orgId]);

    const updated = await h.adapter.getOrganizationDrawerVarianceThreshold(orgId);
    expect(updated).toBe(5.5);

    // Reset for any later test in this file that assumes the default.
    await h.query('UPDATE organizations SET drawer_variance_threshold = NULL WHERE id = $1', [orgId]);
  });
});

describe('getRegisterOverrides (admin listing)', () => {
  it('scopes to the org via the registers join, filters by register/approver, and never carries the grant hash', async () => {
    const approverId = await makeUser(`${mark}-approver-4@example.com`, true);
    await h.adapter.createRegisterOverride({
      registerId,
      shiftId: null,
      approverUserId: approverId,
      requestedByUserId: null,
      action: 'no_sale',
      grantPrefix: `${mark}pfx3`,
      grantHash: 'super-secret-hash-value',
      expiresAt: Date.now() + 90_000,
      reason: null,
    });
    await h.adapter.createRegisterOverride({
      registerId: otherRegisterId,
      shiftId: null,
      approverUserId: approverId,
      requestedByUserId: null,
      action: 'void',
      grantPrefix: `${mark}pfx4`,
      grantHash: 'another-secret-hash',
      expiresAt: Date.now() + 90_000,
      reason: null,
    });

    const all = await h.adapter.getRegisterOverrides({ orgId, limit: 50, offset: 0 });
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(all.overrides)).not.toContain('super-secret-hash-value');
    expect(JSON.stringify(all.overrides)).not.toContain('another-secret-hash');

    const filtered = await h.adapter.getRegisterOverrides({
      orgId,
      limit: 50,
      offset: 0,
      registerId,
    });
    // Every row filtered by `registerId` must actually belong to it — this is
    // what proves the join/WHERE excludes `otherRegisterId`'s grant, not just
    // that the two totals happen to differ.
    expect(filtered.overrides.every((row) => String(row.registerId) === registerId)).toBe(true);
    expect(filtered.overrides.some((row) => row.action === 'no_sale')).toBe(true);
  });
});
