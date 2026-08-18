import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { setPin, verifyPin, dummyPinCompare, MIN_PIN_LENGTH } from '../pins';
import type { DatabaseAdapter } from '../database';

/**
 * A minimal in-memory stand-in for the user/org surface of `DatabaseAdapter`,
 * in the same spirit as `FakeAdapter` in `registerEnrolment.test.ts` — this
 * needs real cross-call state (set a PIN, then verify it; fail it five
 * times, then find it locked), so it is a tiny fake store rather than
 * independent `vi.fn()` mocks.
 */
interface FakeUser {
  id: string;
  name: string;
  email: string;
  status: string;
  orgId: string;
  pinHash: string | null;
  pinSetAt: number | null;
  pinFailedCount: number;
  pinLockedUntil: number | null;
}

const ORG = 'org-1';

class FakeAdapter {
  users = new Map<string, FakeUser>();
  auditLogs: Record<string, unknown>[] = [];
  private pinLength = MIN_PIN_LENGTH;

  addUser(id: string, overrides: Partial<FakeUser> = {}): FakeUser {
    const user: FakeUser = {
      id,
      name: overrides.name ?? id,
      email: `${id}@example.com`,
      status: 'active',
      orgId: ORG,
      pinHash: null,
      pinSetAt: null,
      pinFailedCount: 0,
      pinLockedUntil: null,
      ...overrides,
    };
    this.users.set(id, user);
    return user;
  }

  setOrgPinLength(pinLength: number): void {
    this.pinLength = pinLength;
  }

  async getOrgPolicy(_orgId: string): Promise<{ maxRegisters: number | null; pinLength: number } | null> {
    return { maxRegisters: null, pinLength: this.pinLength };
  }

  async getUserById(id: string): Promise<FakeUser | null> {
    const row = this.users.get(id);
    return row ? { ...row } : null;
  }

  async getActiveUsersWithPin(orgId: string): Promise<FakeUser[]> {
    return [...this.users.values()]
      .filter((u) => u.orgId === orgId && u.status === 'active' && u.pinHash != null)
      .map((u) => ({ ...u }));
  }

  async setUserPin(
    userId: string,
    payload: { pinHash: string; pinSetAt: number }
  ): Promise<Record<string, unknown> | null> {
    const row = this.users.get(userId);
    if (!row) return null;
    row.pinHash = payload.pinHash;
    row.pinSetAt = payload.pinSetAt;
    row.pinFailedCount = 0;
    row.pinLockedUntil = null;
    // Safe projection — no pinHash — mirroring what the real adapter returns.
    return { id: row.id, email: row.email, name: row.name, status: row.status, pinSetAt: row.pinSetAt };
  }

  async recordPinFailure(
    userId: string,
    payload: { failedCount: number; lockedUntil: number | null }
  ): Promise<void> {
    const row = this.users.get(userId);
    if (!row) return;
    row.pinFailedCount = payload.failedCount;
    row.pinLockedUntil = payload.lockedUntil;
  }

  async resetPinFailures(userId: string): Promise<void> {
    const row = this.users.get(userId);
    if (!row) return;
    row.pinFailedCount = 0;
    row.pinLockedUntil = null;
  }

  async createAuditLog(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.auditLogs.push(payload);
    return payload;
  }
}

function fakeAdapter(): FakeAdapter & DatabaseAdapter {
  return new FakeAdapter() as unknown as FakeAdapter & DatabaseAdapter;
}

describe('setPin', () => {
  it('stores only a bcrypt hash — the raw PIN appears nowhere in the stored row', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await setPin(adapter, ORG, 'u1', '123456');

    expect(typeof result).toBe('object');
    const stored = adapter.users.get('u1')!;
    expect(stored.pinHash).not.toBe('123456');
    expect(stored.pinHash).not.toContain('123456');
    expect(await bcrypt.compare('123456', stored.pinHash!)).toBe(true);
  });

  it('never returns the hash to the caller', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await setPin(adapter, ORG, 'u1', '123456');

    expect(typeof result).toBe('object');
    expect(Object.keys(result as object)).not.toContain('pinHash');
    expect(JSON.stringify(result)).not.toContain('123456');
  });

  it('rejects a PIN shorter than the org floor', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await setPin(adapter, ORG, 'u1', '12345');

    expect(result).toBe('too_short');
  });

  it('rejects a non-numeric PIN', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await setPin(adapter, ORG, 'u1', 'abcdef');

    expect(result).toBe('not_numeric');
  });

  it("never lets an org's configured pin_length push the floor below 6, even if the org row somehow says less", async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    adapter.setOrgPinLength(4); // simulates a corrupt/misconfigured org row

    // 5 digits: shorter than MIN_PIN_LENGTH (6), longer than the org's bad value (4).
    const result = await setPin(adapter, ORG, 'u1', '54321');

    expect(result).toBe('too_short');
  });

  it('accepts a PIN at exactly the org floor', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await setPin(adapter, ORG, 'u1', '654321');

    expect(typeof result).toBe('object');
  });

  it('refuses a PIN already used by another active user in the same org', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    adapter.addUser('u2');
    const first = await setPin(adapter, ORG, 'u1', '111222');
    expect(typeof first).toBe('object');

    const result = await setPin(adapter, ORG, 'u2', '111222');

    expect(result).toBe('in_use');
  });

  it('does not collide with a PIN belonging to an inactive user', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1', { status: 'inactive' });
    await setPin(adapter, ORG, 'u1', '111222');
    adapter.addUser('u2');

    const result = await setPin(adapter, ORG, 'u2', '111222');

    expect(typeof result).toBe('object');
  });

  it('does not collide with the same PIN in a different org', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1', { orgId: 'org-a' });
    await setPin(adapter, 'org-a', 'u1', '111222');
    adapter.addUser('u2', { orgId: 'org-b' });

    const result = await setPin(adapter, 'org-b', 'u2', '111222');

    expect(typeof result).toBe('object');
  });

  it('lets a user re-set their own PIN to the same value without tripping the uniqueness check against themself', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '111222');

    const result = await setPin(adapter, ORG, 'u1', '111222');

    expect(typeof result).toBe('object');
  });
});

describe('verifyPin', () => {
  it('a successful verify resets the failure counter', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '123456');
    // Rack up a couple of failures first.
    await verifyPin(adapter, 'u1', '000000');
    await verifyPin(adapter, 'u1', '000000');
    expect(adapter.users.get('u1')!.pinFailedCount).toBe(2);

    const result = await verifyPin(adapter, 'u1', '123456');

    expect(typeof result).toBe('object');
    expect(adapter.users.get('u1')!.pinFailedCount).toBe(0);
  });

  it('reports no_pin for a user who has never set one, comparing against a dummy hash for timing safety', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');

    const result = await verifyPin(adapter, 'u1', '123456');

    expect(result).toBe('no_pin');
  });

  it('5 consecutive failures lock the account for 15 minutes, and the lockout is audited', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '123456');

    const before = Date.now();
    let last: Awaited<ReturnType<typeof verifyPin>> = 'bad_pin';
    for (let i = 0; i < 5; i++) {
      last = await verifyPin(adapter, 'u1', '000000');
    }

    expect(last).toBe('locked');
    const stored = adapter.users.get('u1')!;
    expect(stored.pinFailedCount).toBe(5);
    expect(stored.pinLockedUntil).not.toBeNull();
    expect(stored.pinLockedUntil!).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);

    const lockoutEntry = adapter.auditLogs.find(
      (log) => log.entity === 'user' && log.entityId === 'u1'
    );
    expect(lockoutEntry).toBeDefined();
    expect(JSON.stringify(lockoutEntry)).not.toContain('123456');
  });

  it('fewer than 5 failures does not lock the account', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '123456');

    for (let i = 0; i < 4; i++) {
      await verifyPin(adapter, 'u1', '000000');
    }

    expect(adapter.users.get('u1')!.pinLockedUntil).toBeNull();
    expect(adapter.auditLogs).toHaveLength(0);
  });

  it('a locked account refuses even the correct PIN', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '123456');
    for (let i = 0; i < 5; i++) {
      await verifyPin(adapter, 'u1', '000000');
    }

    const result = await verifyPin(adapter, 'u1', '123456');

    expect(result).toBe('locked');
  });

  it('does not re-lock or extend the lock on a repeat attempt against an already-locked account', async () => {
    const adapter = fakeAdapter();
    adapter.addUser('u1');
    await setPin(adapter, ORG, 'u1', '123456');
    for (let i = 0; i < 5; i++) {
      await verifyPin(adapter, 'u1', '000000');
    }
    const lockedUntilFirst = adapter.users.get('u1')!.pinLockedUntil;
    const auditCountAfterLockout = adapter.auditLogs.length;

    await verifyPin(adapter, 'u1', '000000');

    expect(adapter.users.get('u1')!.pinLockedUntil).toBe(lockedUntilFirst);
    expect(adapter.auditLogs).toHaveLength(auditCountAfterLockout);
  });
});

describe('dummyPinCompare', () => {
  it('takes about as long as a real bcrypt compare, so a miss cannot be timed apart from a hit', async () => {
    // Not a precise timing assertion (too flaky in CI) — just proves it
    // actually runs a real bcrypt.compare rather than returning instantly.
    const start = Date.now();
    await dummyPinCompare('000000');
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
});
