import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * PIN columns (migration 018) and `register_shifts` against a real Postgres.
 *
 * Two things a mocked adapter cannot prove: that `pin_hash` never rides
 * along in a row a route might otherwise be tempted to spread verbatim, and
 * that `idx_register_shifts_one_open_per_register` actually rejects a
 * second open shift at the database level, not merely by the service
 * layer's own bookkeeping.
 */
let h: Harness;
const mark = tag();

/** The well-known org every pre-multi-org row implicitly belongs to — see migration 014 and auth.ts's DEFAULT_ORG_ID. */
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const userIds: string[] = [];
let orgId: string;
let locationId: string;
let registerId: string;

async function makeUser(email: string): Promise<string> {
  const created = await h.adapter.createUser({
    email,
    passwordHash: 'not-a-real-hash',
    name: `${mark} person`,
    status: 'active',
    roleIds: [],
  });
  const id = String(created.id);
  userIds.push(id);
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
}, 30_000);

afterAll(async () => {
  await h.query('DELETE FROM register_shifts WHERE register_id = $1', [registerId]);
  await h.query('DELETE FROM registers WHERE id = $1', [registerId]);
  await h.query('DELETE FROM locations WHERE id = $1', [locationId]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  if (userIds.length > 0) {
    await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  await h.close();
});

describe('PIN columns', () => {
  it('setUserPin stores a hash and never returns it', async () => {
    const userId = await makeUser(`${mark}-a@example.com`);

    const updated = await h.adapter.setUserPin(userId, { pinHash: 'fake-hash-value', pinSetAt: Date.now() });

    expect(updated).not.toBeNull();
    expect(Object.keys(updated as object)).not.toContain('pinHash');
    expect(JSON.stringify(updated)).not.toContain('fake-hash-value');

    const { rows } = await h.query('SELECT pin_hash FROM users WHERE id = $1', [userId]);
    expect(rows[0].pin_hash).toBe('fake-hash-value');
  });

  it('setUserPin clears any prior lockout', async () => {
    const userId = await makeUser(`${mark}-b@example.com`);
    await h.adapter.recordPinFailure(userId, { failedCount: 5, lockedUntil: Date.now() + 60_000 });

    await h.adapter.setUserPin(userId, { pinHash: 'fresh-hash', pinSetAt: Date.now() });

    const user = await h.adapter.getUserById(userId);
    expect(user!.pinFailedCount).toBe(0);
    expect(user!.pinLockedUntil).toBeNull();
  });

  it('getUserById reports pin_failed_count and pin_locked_until after recordPinFailure', async () => {
    const userId = await makeUser(`${mark}-c@example.com`);
    const lockedUntil = Date.now() + 15 * 60 * 1000;

    await h.adapter.recordPinFailure(userId, { failedCount: 3, lockedUntil });

    const user = await h.adapter.getUserById(userId);
    expect(user!.pinFailedCount).toBe(3);
    expect(user!.pinLockedUntil).toBe(lockedUntil);
  });

  it('resetPinFailures clears the counter and the lock', async () => {
    const userId = await makeUser(`${mark}-d@example.com`);
    await h.adapter.recordPinFailure(userId, { failedCount: 4, lockedUntil: Date.now() + 60_000 });

    await h.adapter.resetPinFailures(userId);

    const user = await h.adapter.getUserById(userId);
    expect(user!.pinFailedCount).toBe(0);
    expect(user!.pinLockedUntil).toBeNull();
  });

  it(
    'getActiveUsersWithPin finds a user with org_id NULL under DEFAULT_ORG_ID — ' +
      'the fallback every pre-multi-org row depends on',
    async () => {
      const userId = await makeUser(`${mark}-e@example.com`);
      await h.adapter.setUserPin(userId, { pinHash: 'hash-e', pinSetAt: Date.now() });

      const { rows } = await h.query('SELECT org_id FROM users WHERE id = $1', [userId]);
      expect(rows[0].org_id).toBeNull(); // createUser never sets it

      const candidates = await h.adapter.getActiveUsersWithPin(DEFAULT_ORG_ID);

      expect(candidates.some((u) => String(u.id) === userId)).toBe(true);
    }
  );

  it('getActiveUsersWithPin excludes an inactive user even with a PIN set', async () => {
    const userId = await makeUser(`${mark}-f@example.com`);
    await h.adapter.setUserPin(userId, { pinHash: 'hash-f', pinSetAt: Date.now() });
    await h.query("UPDATE users SET status = 'inactive' WHERE id = $1", [userId]);

    const candidates = await h.adapter.getActiveUsersWithPin(DEFAULT_ORG_ID);

    expect(candidates.some((u) => String(u.id) === userId)).toBe(false);
  });

  it('no user-facing read (getAllUsers, getUserByEmail) ever includes a pin field', async () => {
    const email = `${mark}-g@example.com`;
    const userId = await makeUser(email);
    await h.adapter.setUserPin(userId, { pinHash: 'super-secret-hash', pinSetAt: Date.now() });

    const all = await h.adapter.getAllUsers();
    const byEmail = await h.adapter.getUserByEmail(email);

    expect(JSON.stringify(all)).not.toContain('super-secret-hash');
    expect(JSON.stringify(all).toLowerCase()).not.toContain('pinhash');
    expect(JSON.stringify(byEmail)).not.toContain('super-secret-hash');
    expect(JSON.stringify(byEmail).toLowerCase()).not.toContain('pinhash');
  });
});

describe('register_shifts', () => {
  it('createRegisterShift, getOpenShiftForRegister, touchRegisterShiftActivity, and endRegisterShift round-trip', async () => {
    const userId = await makeUser(`${mark}-h@example.com`);

    const created = await h.adapter.createRegisterShift({ registerId, userId });
    expect(created.registerId).toBe(registerId);
    expect(created.endedAt).toBeNull();

    const open = await h.adapter.getOpenShiftForRegister(registerId);
    expect(open!.id).toBe(created.id);

    const before = open!.lastActivityAt as number;
    const touched = await h.adapter.touchRegisterShiftActivity(String(created.id));
    expect(Number(touched!.lastActivityAt)).toBeGreaterThanOrEqual(before);

    const ended = await h.adapter.endRegisterShift(String(created.id), 'signed_out');
    expect(ended!.endReason).toBe('signed_out');
    expect(ended!.endedAt).not.toBeNull();

    expect(await h.adapter.getOpenShiftForRegister(registerId)).toBeNull();
  });

  it('ending an already-ended shift is a no-op', async () => {
    const userId = await makeUser(`${mark}-i@example.com`);
    const created = await h.adapter.createRegisterShift({ registerId, userId });
    await h.adapter.endRegisterShift(String(created.id), 'signed_out');

    const result = await h.adapter.endRegisterShift(String(created.id), 'idle_timeout');

    expect(result).toBeNull();
  });

  it(
    'idx_register_shifts_one_open_per_register (raw SQL) rejects a second open shift on the same ' +
      'register, but ending the first clears the way for a new one',
    async () => {
      const userA = await makeUser(`${mark}-j@example.com`);
      const userB = await makeUser(`${mark}-k@example.com`);
      const first = await h.adapter.createRegisterShift({ registerId, userId: userA });

      await expect(h.adapter.createRegisterShift({ registerId, userId: userB })).rejects.toThrow();

      await h.adapter.endRegisterShift(String(first.id), 'superseded');

      const second = await h.adapter.createRegisterShift({ registerId, userId: userB });
      expect(second.userId).toBe(userB);
    }
  );
});
