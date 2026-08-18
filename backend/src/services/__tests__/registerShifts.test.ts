import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { startShift, endShift, touchShift, getOpenShift } from '../registerShifts';
import { setPin } from '../pins';
import type { DatabaseAdapter } from '../database';

/**
 * A minimal in-memory stand-in for the register/user/shift surface of
 * `DatabaseAdapter`, in the same spirit as `FakeAdapter` in
 * `registerEnrolment.test.ts` and `pins.test.ts` — these flows need real
 * cross-call state (open a shift, then supersede it; go idle, then prove a
 * later touch postpones expiry), so this is a tiny fake store.
 */
interface FakeRegister {
  id: string;
  orgId: string;
  status: string;
  idleLockSeconds: number;
}

interface FakeUser {
  id: string;
  name: string;
  status: string;
  orgId: string;
  pinHash: string | null;
  pinSetAt: number | null;
  pinFailedCount: number;
  pinLockedUntil: number | null;
}

interface FakeShift {
  id: string;
  registerId: string;
  userId: string;
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  endReason: string | null;
}

const ORG = 'org-1';

class FakeAdapter {
  registers = new Map<string, FakeRegister>();
  users = new Map<string, FakeUser>();
  shifts = new Map<string, FakeShift>();
  auditLogs: Record<string, unknown>[] = [];
  private seq = 0;
  private pinLength = 6;

  addRegister(id: string, overrides: Partial<FakeRegister> = {}): FakeRegister {
    const row: FakeRegister = { id, orgId: ORG, status: 'active', idleLockSeconds: 300, ...overrides };
    this.registers.set(id, row);
    return row;
  }

  addUser(id: string, overrides: Partial<FakeUser> = {}): FakeUser {
    const row: FakeUser = {
      id,
      name: overrides.name ?? id,
      status: 'active',
      orgId: ORG,
      pinHash: null,
      pinSetAt: null,
      pinFailedCount: 0,
      pinLockedUntil: null,
      ...overrides,
    };
    this.users.set(id, row);
    return row;
  }

  async getOrgPolicy(): Promise<{ maxRegisters: number | null; pinLength: number } | null> {
    return { maxRegisters: null, pinLength: this.pinLength };
  }

  async getRegisterById(id: string): Promise<FakeRegister | null> {
    const row = this.registers.get(id);
    return row ? { ...row } : null;
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
    return { id: row.id, name: row.name, status: row.status, pinSetAt: row.pinSetAt };
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

  async getOpenShiftForRegister(registerId: string): Promise<FakeShift | null> {
    for (const row of this.shifts.values()) {
      if (row.registerId === registerId && row.endedAt == null) return { ...row };
    }
    return null;
  }

  async createRegisterShift(payload: { registerId: string; userId: string }): Promise<FakeShift> {
    const id = `shift-${++this.seq}`;
    const now = Date.now();
    const row: FakeShift = {
      id,
      registerId: payload.registerId,
      userId: payload.userId,
      startedAt: now,
      lastActivityAt: now,
      endedAt: null,
      endReason: null,
    };
    this.shifts.set(id, row);
    return { ...row };
  }

  async endRegisterShift(shiftId: string, reason: string): Promise<FakeShift | null> {
    const row = this.shifts.get(shiftId);
    if (!row || row.endedAt != null) return null;
    row.endedAt = Date.now();
    row.endReason = reason;
    return { ...row };
  }

  async touchRegisterShiftActivity(shiftId: string): Promise<FakeShift | null> {
    const row = this.shifts.get(shiftId);
    if (!row || row.endedAt != null) return null;
    row.lastActivityAt = Date.now();
    return { ...row };
  }
}

function fakeAdapter(): FakeAdapter & DatabaseAdapter {
  return new FakeAdapter() as unknown as FakeAdapter & DatabaseAdapter;
}

/** Give a user an active PIN, bypassing the route layer. */
async function withPin(adapter: FakeAdapter & DatabaseAdapter, userId: string, pin: string): Promise<void> {
  const result = await setPin(adapter, ORG, userId, pin);
  if (typeof result !== 'object') throw new Error(`expected setPin to succeed, got ${result}`);
}

describe('startShift', () => {
  it('signs on the cashier whose PIN was entered, and never mints a token', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1', { name: 'Alex' });
    await withPin(adapter, 'u1', '123456');

    const result = await startShift(adapter, { registerId: 'r1', pin: '123456' });

    if (typeof result !== 'object') throw new Error(`expected a shift, got ${result}`);
    expect(result.shift.registerId).toBe('r1');
    expect(result.shift.userId).toBe('u1');
    expect(result.user.id).toBe('u1');
    expect(result.user.name).toBe('Alex');
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });

  it('refuses a PIN that matches nobody in the org', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');

    const result = await startShift(adapter, { registerId: 'r1', pin: '999999' });

    expect(result).toBe('bad_pin');
  });

  it('a blind wrong guess does not lock out the account it happened to almost resemble', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');

    for (let i = 0; i < 10; i++) {
      await startShift(adapter, { registerId: 'r1', pin: '999999' });
    }

    expect(adapter.users.get('u1')!.pinLockedUntil).toBeNull();
  });

  it('reports locked when the matched PIN belongs to an already-locked account', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    // Lock the account directly via 5 failed verifies, bypassing the till.
    const { verifyPin } = await import('../pins');
    for (let i = 0; i < 5; i++) {
      await verifyPin(adapter, 'u1', '000000');
    }

    const result = await startShift(adapter, { registerId: 'r1', pin: '123456' });

    expect(result).toBe('locked');
  });

  it('cannot be started on a register that does not exist', async () => {
    const adapter = fakeAdapter();

    const result = await startShift(adapter, { registerId: 'nope', pin: '123456' });

    expect(result).toBe('register_not_found');
  });

  it('cannot be started on a non-active register', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', { status: 'disabled' });
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');

    const result = await startShift(adapter, { registerId: 'r1', pin: '123456' });

    expect(result).toBe('register_not_active');
  });

  it('starting a second shift supersedes the first, recording end_reason "superseded"', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    adapter.addUser('u2');
    await withPin(adapter, 'u1', '111111');
    await withPin(adapter, 'u2', '222222');

    const first = await startShift(adapter, { registerId: 'r1', pin: '111111' });
    if (typeof first !== 'object') throw new Error('expected a shift');

    const second = await startShift(adapter, { registerId: 'r1', pin: '222222' });
    if (typeof second !== 'object') throw new Error('expected a shift');

    expect(second.supersededShiftId).toBe(first.shift.id);
    const firstAfter = adapter.shifts.get(String(first.shift.id))!;
    expect(firstAfter.endedAt).not.toBeNull();
    expect(firstAfter.endReason).toBe('superseded');

    // Only the new shift is open.
    const open = await getOpenShift(adapter, 'r1');
    expect(open!.id).toBe(second.shift.id);
    expect(open!.userId).toBe('u2');
  });
});

describe('getOpenShift idle expiry', () => {
  it('expires a shift once last_activity_at is older than idle_lock_seconds, and reports null', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', { idleLockSeconds: 1 }); // 1 second, for a fast test
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    const started = await startShift(adapter, { registerId: 'r1', pin: '123456' });
    if (typeof started !== 'object') throw new Error('expected a shift');

    // Back-date last_activity_at rather than sleeping for real.
    adapter.shifts.get(String(started.shift.id))!.lastActivityAt = Date.now() - 5000;

    const open = await getOpenShift(adapter, 'r1');

    expect(open).toBeNull();
    const stored = adapter.shifts.get(String(started.shift.id))!;
    expect(stored.endedAt).not.toBeNull();
    expect(stored.endReason).toBe('idle_timeout');
  });

  it('activity postpones expiry: touching the shift keeps it open past what would otherwise be its idle deadline', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', { idleLockSeconds: 1 });
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    const started = await startShift(adapter, { registerId: 'r1', pin: '123456' });
    if (typeof started !== 'object') throw new Error('expected a shift');

    // Without a touch this would already be stale...
    adapter.shifts.get(String(started.shift.id))!.lastActivityAt = Date.now() - 5000;
    // ...but activity resets the clock before anything reads it as expired.
    await touchShift(adapter, String(started.shift.id));

    const open = await getOpenShift(adapter, 'r1');

    expect(open).not.toBeNull();
    expect(open!.id).toBe(started.shift.id);
  });

  it('is measured from last_activity_at, not started_at — a long-running shift with recent activity stays open', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', { idleLockSeconds: 1 });
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    const started = await startShift(adapter, { registerId: 'r1', pin: '123456' });
    if (typeof started !== 'object') throw new Error('expected a shift');

    const shift = adapter.shifts.get(String(started.shift.id))!;
    // started 6 hours ago — would fail a started_at-based check outright —
    // but activity was just now.
    shift.startedAt = Date.now() - 6 * 60 * 60 * 1000;
    shift.lastActivityAt = Date.now();

    const open = await getOpenShift(adapter, 'r1');

    expect(open).not.toBeNull();
  });

  it('returns null, not an error, when nothing is open', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');

    expect(await getOpenShift(adapter, 'r1')).toBeNull();
  });
});

describe('endShift', () => {
  it('ends an open shift with the stated reason', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    const started = await startShift(adapter, { registerId: 'r1', pin: '123456' });
    if (typeof started !== 'object') throw new Error('expected a shift');

    const ended = await endShift(adapter, String(started.shift.id), 'signed_out');

    expect(ended!.endReason).toBe('signed_out');
    expect(await getOpenShift(adapter, 'r1')).toBeNull();
  });

  it('ending an already-ended shift is a no-op', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');
    const started = await startShift(adapter, { registerId: 'r1', pin: '123456' });
    if (typeof started !== 'object') throw new Error('expected a shift');
    await endShift(adapter, String(started.shift.id), 'signed_out');

    const result = await endShift(adapter, String(started.shift.id), 'signed_out');

    expect(result).toBeNull();
  });
});

describe('the raw PIN is never stored anywhere in a shift', () => {
  it('a bcrypt hash cannot be reversed to the PIN, and the shift row never carries it', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1');
    adapter.addUser('u1');
    await withPin(adapter, 'u1', '123456');

    const result = await startShift(adapter, { registerId: 'r1', pin: '123456' });

    if (typeof result !== 'object') throw new Error('expected a shift');
    expect(JSON.stringify(result.shift)).not.toContain('123456');
    await expect(bcrypt.compare('123456', String(adapter.users.get('u1')!.pinHash))).resolves.toBe(true);
  });
});
