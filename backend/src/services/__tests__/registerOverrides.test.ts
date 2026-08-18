import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { DatabaseAdapter } from '../database';
import { requestOverride, consumeOverride, type OverrideAction } from '../registerOverrides';

/**
 * `services/registerOverrides.ts`, exercised directly against a fake
 * in-memory adapter — same spirit as `registerShifts.test.ts`'s fake, but
 * calling the service functions directly rather than going through HTTP,
 * since the property under test (the cashier's shift never changes) is a
 * service-layer guarantee, not a routing concern.
 */

const ORG_ID = 'org-1';
const REGISTER_A = 'reg-a';
const REGISTER_B = 'reg-b';

interface FakeUser {
  id: string;
  name: string;
  status: string;
  orgId: string;
  pinHash: string | null;
  pinFailedCount: number;
  pinLockedUntil: number | null;
  canOverride: boolean;
}

interface FakeRegister {
  id: string;
  orgId: string;
  idleLockSeconds: number;
}

interface FakeShift {
  id: string;
  registerId: string;
  userId: string;
  endedAt: number | null;
  endReason: string | null;
  lastActivityAt: number;
}

interface FakeOverride {
  id: string;
  registerId: string;
  shiftId: string | null;
  approverUserId: string;
  requestedByUserId: string | null;
  action: string;
  grantPrefix: string;
  grantHash: string;
  expiresAt: number;
  consumedAt: number | null;
  entity: string | null;
  entityId: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  reason: string | null;
  createdAt: number;
}

let users: Map<string, FakeUser>;
let registers: Map<string, FakeRegister>;
let shifts: Map<string, FakeShift>;
let overrides: Map<string, FakeOverride>;
let seq: number;

function resetState(): void {
  users = new Map();
  registers = new Map();
  shifts = new Map();
  overrides = new Map();
  seq = 0;
}
resetState();

function makeAdapter(): DatabaseAdapter {
  const adapter = {
    async getRegisterById(id: string) {
      const row = registers.get(id);
      return row ? { ...row } : null;
    },
    async getActiveUsersWithOverridePermission(orgId: string) {
      return [...users.values()].filter(
        (u) => u.orgId === orgId && u.status === 'active' && u.pinHash != null && u.canOverride
      );
    },
    async getUserById(id: string) {
      const row = users.get(id);
      return row ? { ...row } : null;
    },
    async recordPinFailure(userId: string, payload: { failedCount: number; lockedUntil: number | null }) {
      const row = users.get(userId);
      if (row) {
        row.pinFailedCount = payload.failedCount;
        row.pinLockedUntil = payload.lockedUntil;
      }
    },
    async resetPinFailures(userId: string) {
      const row = users.get(userId);
      if (row) {
        row.pinFailedCount = 0;
        row.pinLockedUntil = null;
      }
    },
    async createAuditLog(payload: Record<string, unknown>) {
      return payload;
    },
    async getOpenShiftForRegister(registerId: string) {
      for (const row of shifts.values()) {
        if (row.registerId === registerId && row.endedAt == null) return { ...row };
      }
      return null;
    },
    async endRegisterShift(id: string, reason: string) {
      const row = shifts.get(id);
      if (!row || row.endedAt != null) return null;
      row.endedAt = Date.now();
      row.endReason = reason;
      return { ...row };
    },
    async touchRegisterShiftActivity(id: string) {
      const row = shifts.get(id);
      if (!row || row.endedAt != null) return null;
      row.lastActivityAt = Date.now();
      return { ...row };
    },
    async createRegisterOverride(payload: Record<string, unknown>) {
      const id = `ovr-${++seq}`;
      const row: FakeOverride = {
        id,
        consumedAt: null,
        entity: null,
        entityId: null,
        beforeValue: null,
        afterValue: null,
        createdAt: Date.now(),
        ...(payload as Omit<FakeOverride, 'id' | 'consumedAt' | 'entity' | 'entityId' | 'beforeValue' | 'afterValue' | 'createdAt'>),
      };
      overrides.set(id, row);
      return { ...row };
    },
    async getRegisterOverridesByPrefix(prefix: string) {
      return [...overrides.values()].filter((row) => row.grantPrefix === prefix).map((row) => ({ ...row }));
    },
    async consumeRegisterOverride(
      id: string,
      payload: { entity: string | null; entityId: string | null; beforeValue: string | null; afterValue: string | null }
    ) {
      const row = overrides.get(id);
      if (!row || row.consumedAt != null) return null;
      row.consumedAt = Date.now();
      row.entity = payload.entity;
      row.entityId = payload.entityId;
      row.beforeValue = payload.beforeValue;
      row.afterValue = payload.afterValue;
      return { ...row };
    },
  };
  return adapter as unknown as DatabaseAdapter;
}

function seedRegister(id: string): void {
  registers.set(id, { id, orgId: ORG_ID, idleLockSeconds: 300 });
}

function seedApprover(id: string, pin: string, canOverride = true): void {
  users.set(id, {
    id,
    name: 'Boss',
    status: 'active',
    orgId: ORG_ID,
    pinHash: bcrypt.hashSync(pin, 4),
    pinFailedCount: 0,
    pinLockedUntil: null,
    canOverride,
  });
}

function seedShift(id: string, registerId: string, userId: string): void {
  shifts.set(id, {
    id,
    registerId,
    userId,
    endedAt: null,
    endReason: null,
    lastActivityAt: Date.now(),
  });
}

beforeEach(() => {
  resetState();
  seedRegister(REGISTER_A);
  seedRegister(REGISTER_B);
});

describe('requestOverride', () => {
  it('refuses a PIN belonging to a user without can_override', async () => {
    // A real cashier, with a real PIN — just not one the till trusts to
    // approve anything. Must be indistinguishable from a PIN nobody has.
    seedApprover('cashier-1', '111111', false);

    const result = await requestOverride(makeAdapter(), {
      registerId: REGISTER_A,
      action: 'void',
      pin: '111111',
    });

    expect(result).toBe('bad_pin');
  });

  it('refuses a PIN that matches nobody at all', async () => {
    seedApprover('boss-1', '222222');

    const result = await requestOverride(makeAdapter(), {
      registerId: REGISTER_A,
      action: 'void',
      pin: '000000',
    });

    expect(result).toBe('bad_pin');
  });

  it('leaves the cashier shift completely unchanged', async () => {
    seedApprover('boss-1', '333333');
    seedShift('shift-1', REGISTER_A, 'cashier-1');
    const before = { ...shifts.get('shift-1')! };

    const result = await requestOverride(makeAdapter(), {
      registerId: REGISTER_A,
      action: 'void',
      pin: '333333',
    });

    expect(typeof result).toBe('object');
    const after = shifts.get('shift-1')!;
    expect(after.id).toBe(before.id);
    expect(after.userId).toBe(before.userId);
    expect(after.endedAt).toBeNull();
    expect(after.endReason).toBeNull();
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
  });

  it('records the approver, the requester (the open shift), and the action on the grant row', async () => {
    seedApprover('boss-1', '444444');
    seedShift('shift-1', REGISTER_A, 'cashier-1');

    const result = await requestOverride(makeAdapter(), {
      registerId: REGISTER_A,
      action: 'drawer_variance',
      pin: '444444',
    });
    if (typeof result === 'string') throw new Error(`expected success, got ${result}`);

    expect(result.override.approverUserId).toBe('boss-1');
    expect(result.override.requestedByUserId).toBe('cashier-1');
    expect(result.override.action).toBe('drawer_variance');
    expect(result.override.shiftId).toBe('shift-1');
  });

  it('bcrypt-hashes the grant; the plaintext token is never stored', async () => {
    seedApprover('boss-1', '555555');

    const result = await requestOverride(makeAdapter(), {
      registerId: REGISTER_A,
      action: 'no_sale',
      pin: '555555',
    });
    if (typeof result === 'string') throw new Error(`expected success, got ${result}`);

    const stored = overrides.get(String(result.override.id))!;
    expect(stored.grantHash).not.toBe(result.token);
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(bcrypt.compareSync(result.token, stored.grantHash)).toBe(true);
  });
});

describe('consumeOverride', () => {
  async function grant(action: OverrideAction, registerId = REGISTER_A): Promise<string> {
    seedApprover('boss-1', '999999');
    const result = await requestOverride(makeAdapter(), { registerId, action, pin: '999999' });
    if (typeof result === 'string') throw new Error(`expected success, got ${result}`);
    return result.token;
  }

  it('returns unknown for a token naming no grant at all', async () => {
    const result = await consumeOverride(makeAdapter(), {
      token: 'ovr_deadbeef_' + '0'.repeat(32),
      action: 'void',
      registerId: REGISTER_A,
    });

    expect(result).toBe('unknown');
  });

  it('authorises exactly one action; a second consume returns spent', async () => {
    const token = await grant('void');
    const adapter = makeAdapter();

    const first = await consumeOverride(adapter, { token, action: 'void', registerId: REGISTER_A });
    expect(typeof first).toBe('object');

    const second = await consumeOverride(adapter, { token, action: 'void', registerId: REGISTER_A });
    expect(second).toBe('spent');
  });

  it('refuses a grant spent on a different action than it was issued for', async () => {
    const token = await grant('discount_approval');
    const adapter = makeAdapter();

    const result = await consumeOverride(adapter, {
      token,
      action: 'void',
      registerId: REGISTER_A,
    });

    expect(result).toBe('action_mismatch');
  });

  it('a grant from one register cannot be spent at another', async () => {
    const token = await grant('void', REGISTER_A);
    const adapter = makeAdapter();

    const wrongRegister = await consumeOverride(adapter, { token, action: 'void', registerId: REGISTER_B });
    expect(wrongRegister).toBe('register_mismatch');

    // Refusing at the wrong register must not have burned the grant — it is
    // still good at the register it was actually issued for.
    const rightRegister = await consumeOverride(adapter, { token, action: 'void', registerId: REGISTER_A });
    expect(typeof rightRegister).toBe('object');
  });

  it('expires 90 seconds after being issued', async () => {
    vi.useFakeTimers();
    try {
      const token = await grant('drawer_variance');
      vi.advanceTimersByTime(90_001);

      const result = await consumeOverride(makeAdapter(), {
        token,
        action: 'drawer_variance',
        registerId: REGISTER_A,
      });

      expect(result).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is still good just under 90 seconds', async () => {
    vi.useFakeTimers();
    try {
      const token = await grant('no_sale');
      vi.advanceTimersByTime(89_000);

      const result = await consumeOverride(makeAdapter(), {
        token,
        action: 'no_sale',
        registerId: REGISTER_A,
      });

      expect(typeof result).toBe('object');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records what was actually done — entity, entityId, before and after values', async () => {
    const token = await grant('drawer_variance');
    const adapter = makeAdapter();

    const result = await consumeOverride(adapter, {
      token,
      action: 'drawer_variance',
      registerId: REGISTER_A,
      entity: 'drawer_session',
      entityId: 'ds-1',
      beforeValue: 250.5,
      afterValue: 240,
    });
    if (typeof result === 'string') throw new Error(`expected success, got ${result}`);

    expect(result.override.entity).toBe('drawer_session');
    expect(result.override.entityId).toBe('ds-1');
    expect(result.override.beforeValue).toBe('250.5');
    expect(result.override.afterValue).toBe('240');
    expect(result.override.consumedAt).not.toBeNull();
  });
});
