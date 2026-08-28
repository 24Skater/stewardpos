import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * The password lockout columns (migration 025) against a real Postgres.
 *
 * Every other test of this feature mocks the adapter, which means every one of
 * them would still pass if the SQL were wrong, the columns absent, or the
 * migration never applied. That is not a hypothetical failure mode here: the
 * whole lockout is two columns and two `UPDATE`s, and the service reads the
 * state back through `getUserByEmail` — so a mapping that forgot to select
 * them would leave `passwordFailedCount` permanently `undefined` and the
 * account would never lock, silently, with a full green suite.
 *
 * So this asserts the round trip: write through the adapter, read back through
 * the same call the login route uses.
 */
let h: Harness;
const mark = tag();

const userIds: string[] = [];

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
}, 30_000);

afterAll(async () => {
  if (userIds.length > 0) {
    await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  await h.close();
});

describe('password lockout columns', () => {
  it('starts every account unlocked with a zero count', async () => {
    const email = `${mark}-fresh@example.com`;
    await makeUser(email);

    const user = await h.adapter.getUserByEmail(email);

    // Migration 025 declares NOT NULL DEFAULT 0, so a row created without
    // mentioning the column still reads back as zero rather than null.
    expect(user?.passwordFailedCount).toBe(0);
    expect(user?.passwordLockedUntil).toBeNull();
  });

  it('records a failure and reads it back through the login path', async () => {
    const email = `${mark}-counting@example.com`;
    const id = await makeUser(email);

    await h.adapter.recordPasswordFailure(id, { failedCount: 3, lockedUntil: null });

    const user = await h.adapter.getUserByEmail(email);
    expect(user?.passwordFailedCount).toBe(3);
    expect(user?.passwordLockedUntil).toBeNull();
  });

  it('stores a lockout and returns it as epoch milliseconds', async () => {
    const email = `${mark}-locked@example.com`;
    const id = await makeUser(email);
    // Whole seconds: the column is a timestamp without time zone, and the
    // round trip should not be asserted against sub-millisecond precision.
    const lockedUntil = Math.floor((Date.now() + 600_000) / 1000) * 1000;

    await h.adapter.recordPasswordFailure(id, { failedCount: 10, lockedUntil });

    const user = await h.adapter.getUserByEmail(email);
    // A number, not a Date and not a string. `verifyPasswordLogin` compares it
    // against Date.now(), and a string would compare as NaN and never lock.
    expect(typeof user?.passwordLockedUntil).toBe('number');
    expect(user?.passwordLockedUntil).toBe(lockedUntil);
    expect(user?.passwordFailedCount).toBe(10);
  });

  it('clears both on reset, which is what the unlock endpoint calls', async () => {
    const email = `${mark}-unlock@example.com`;
    const id = await makeUser(email);
    await h.adapter.recordPasswordFailure(id, { failedCount: 10, lockedUntil: Date.now() + 600_000 });

    await h.adapter.resetPasswordFailures(id);

    const user = await h.adapter.getUserByEmail(email);
    expect(user?.passwordFailedCount).toBe(0);
    expect(user?.passwordLockedUntil).toBeNull();
  });

  it('keeps the password lockout independent of the PIN lockout', async () => {
    // Separate state on the same row. Clearing one must not clear the other:
    // a cashier locked out of the till may have a perfectly good password.
    const email = `${mark}-both@example.com`;
    const id = await makeUser(email);
    const until = Date.now() + 600_000;

    await h.adapter.recordPasswordFailure(id, { failedCount: 10, lockedUntil: until });
    await h.adapter.recordPinFailure(id, { failedCount: 5, lockedUntil: until });

    await h.adapter.resetPasswordFailures(id);

    const rows = await h.query(
      'SELECT password_failed_count, password_locked_until, pin_failed_count, pin_locked_until FROM users WHERE id = $1',
      [id]
    );
    const row = rows.rows[0];
    expect(Number(row.password_failed_count)).toBe(0);
    expect(row.password_locked_until).toBeNull();
    // Untouched.
    expect(Number(row.pin_failed_count)).toBe(5);
    expect(row.pin_locked_until).not.toBeNull();
  });

  it('never lets the hash out through the login read', async () => {
    // getUserByEmail deliberately DOES return passwordHash - the login route
    // needs it. What must not happen is the lockout work adding anything else
    // sensitive to that shape.
    const email = `${mark}-shape@example.com`;
    await makeUser(email);

    const user = await h.adapter.getUserByEmail(email);
    expect(Object.keys(user ?? {}).sort()).toEqual(
      [
        'createdAt', 'email', 'id', 'lastLoginAt', 'name', 'orgId',
        'passwordFailedCount', 'passwordHash', 'passwordLockedUntil',
        'roleIds', 'roles', 'status',
      ].sort()
    );
  });
});
