import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  generatePairingCode,
  formatPairingCode,
  normalizePairingCode,
  issuePairingCode,
  redeemPairingCode,
  verifyDeviceToken,
  revokeCredential,
} from '../registerEnrolment';
import type { DatabaseAdapter } from '../database';

/**
 * A minimal in-memory stand-in for the register/credential surface of
 * `DatabaseAdapter`, in the same spirit as `stubAdapter` in
 * `registers.test.ts` — except this one needs real cross-call state
 * (issue, then redeem, then revoke, then verify all act on the same row),
 * so it is a tiny fake store rather than a set of independent `vi.fn()`
 * mocks.
 */
interface FakeRegisterRow {
  id: string;
  status: string;
  displayCode: string;
  idleLockSeconds: number;
}

interface FakeShiftRow {
  id: string;
  registerId: string;
  userId: string;
  lastActivityAt: number;
  endedAt: number | null;
  endReason: string | null;
}

interface FakeCredentialRow {
  id: string;
  registerId: string;
  pairingCodePrefix: string;
  pairingCodeHash: string;
  pairingExpiresAt: number;
  tokenPrefix: string | null;
  tokenHash: string | null;
  enrolledAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
  createdBy: string | null;
  createdAt: number;
}

class FakeAdapter {
  registers = new Map<string, FakeRegisterRow>();
  credentials = new Map<string, FakeCredentialRow>();
  shifts = new Map<string, FakeShiftRow>();
  private nextId = 0;

  addRegister(id: string, status: string = 'pending'): void {
    this.registers.set(id, { id, status, displayCode: id.toUpperCase(), idleLockSeconds: 300 });
  }

  /** Opens a shift directly, bypassing `startShift` — this file tests `revokeCredential`, not sign-on. */
  addOpenShift(id: string, registerId: string, userId: string = 'u1'): void {
    this.shifts.set(id, { id, registerId, userId, lastActivityAt: Date.now(), endedAt: null, endReason: null });
  }

  async getOpenShiftForRegister(registerId: string): Promise<FakeShiftRow | null> {
    for (const row of this.shifts.values()) {
      if (row.registerId === registerId && row.endedAt == null) return { ...row };
    }
    return null;
  }

  async endRegisterShift(shiftId: string, reason: string): Promise<FakeShiftRow | null> {
    const row = this.shifts.get(shiftId);
    if (!row || row.endedAt != null) return null;
    row.endedAt = Date.now();
    row.endReason = reason;
    return { ...row };
  }

  async getRegisterById(id: string): Promise<FakeRegisterRow | null> {
    const row = this.registers.get(id);
    return row ? { ...row } : null;
  }

  async setRegisterStatus(id: string, status: string): Promise<FakeRegisterRow | null> {
    const row = this.registers.get(id);
    if (!row) return null;
    row.status = status;
    return { ...row };
  }

  async getLiveUnredeemedPairingCredential(registerId: string): Promise<FakeCredentialRow | null> {
    for (const row of this.credentials.values()) {
      if (row.registerId === registerId && row.revokedAt == null && row.tokenHash == null) {
        return { ...row };
      }
    }
    return null;
  }

  async getLiveEnrolledCredential(registerId: string): Promise<FakeCredentialRow | null> {
    for (const row of this.credentials.values()) {
      if (row.registerId === registerId && row.revokedAt == null && row.tokenHash != null) {
        return { ...row };
      }
    }
    return null;
  }

  async getLiveRegisterCredentials(registerId: string): Promise<FakeCredentialRow[]> {
    return [...this.credentials.values()]
      .filter((row) => row.registerId === registerId && row.revokedAt == null)
      .map((row) => ({ ...row }));
  }

  async createPairingCredential(payload: {
    registerId: string;
    pairingCodePrefix: string;
    pairingCodeHash: string;
    pairingExpiresAt: number;
    createdBy: string | null;
  }): Promise<FakeCredentialRow> {
    const id = `cred-${++this.nextId}`;
    const row: FakeCredentialRow = {
      id,
      registerId: payload.registerId,
      pairingCodePrefix: payload.pairingCodePrefix,
      pairingCodeHash: payload.pairingCodeHash,
      pairingExpiresAt: payload.pairingExpiresAt,
      tokenPrefix: null,
      tokenHash: null,
      enrolledAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      createdBy: payload.createdBy,
      createdAt: Date.now(),
    };
    this.credentials.set(id, row);
    return { ...row };
  }

  async getPairingCredentialsByPrefix(prefix: string): Promise<FakeCredentialRow[]> {
    return [...this.credentials.values()]
      .filter((row) => row.pairingCodePrefix === prefix)
      .map((row) => ({ ...row }));
  }

  async redeemPairingCredential(
    id: string,
    payload: { tokenPrefix: string; tokenHash: string; enrolledAt: number }
  ): Promise<FakeCredentialRow | null> {
    const row = this.credentials.get(id);
    if (!row || row.enrolledAt != null || row.revokedAt != null) return null;
    row.tokenPrefix = payload.tokenPrefix;
    row.tokenHash = payload.tokenHash;
    row.enrolledAt = payload.enrolledAt;
    return { ...row };
  }

  async getRegisterCredentialsByTokenPrefix(prefix: string): Promise<FakeCredentialRow[]> {
    return [...this.credentials.values()]
      .filter((row) => row.tokenPrefix === prefix)
      .map((row) => ({ ...row }));
  }

  async touchRegisterCredentialLastUsed(id: string): Promise<void> {
    const row = this.credentials.get(id);
    if (row) row.lastUsedAt = Date.now();
  }

  async revokeRegisterCredentialById(
    id: string,
    payload: { revokedBy: string | null; reason: string | null }
  ): Promise<FakeCredentialRow | null> {
    const row = this.credentials.get(id);
    if (!row || row.revokedAt != null) return null;
    row.revokedAt = Date.now();
    row.revokedBy = payload.revokedBy;
    row.revokeReason = payload.reason;
    return { ...row };
  }
}

function fakeAdapter(): FakeAdapter & DatabaseAdapter {
  return new FakeAdapter() as unknown as FakeAdapter & DatabaseAdapter;
}

describe('generatePairingCode', () => {
  it('excludes the ambiguous characters 0, O, 1, I, L', () => {
    const banned = new Set(['0', 'O', '1', 'I', 'L']);

    for (let i = 0; i < 500; i++) {
      const code = generatePairingCode();
      for (const char of code) {
        expect(banned.has(char), `code ${code} contains banned character ${char}`).toBe(false);
      }
    }
  });

  it('is 8 characters long', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePairingCode()).toHaveLength(8);
    }
  });

  it('is drawn from only uppercase letters and digits', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
  });
});

describe('formatPairingCode / normalizePairingCode', () => {
  it('formats as two groups of four', () => {
    expect(formatPairingCode('ABCD2345')).toBe('ABCD-2345');
  });

  it('round-trips through normalize after formatting', () => {
    const code = generatePairingCode();
    expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
  });

  it('normalizes lowercase and stray whitespace', () => {
    expect(normalizePairingCode(' abcd - 2345 ')).toBe('ABCD2345');
  });
});

describe('issuePairingCode', () => {
  it('rejects a retired register', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'retired');

    const result = await issuePairingCode(adapter, 'r1', 'u1');

    expect(result).toBe('retired');
  });

  it('reports not_found for a register that does not exist', async () => {
    const adapter = fakeAdapter();

    const result = await issuePairingCode(adapter, 'nope', 'u1');

    expect(result).toBe('not_found');
  });

  it('issuing twice replaces the outstanding code: the first no longer redeems, the second does', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');

    const first = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof first !== 'object') throw new Error('expected a pairing code');
    const second = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof second !== 'object') throw new Error('expected a pairing code');

    // Only one live pairing row should remain — the second call's insert.
    const live = [...adapter.credentials.values()].filter((c) => c.revokedAt == null);
    expect(live).toHaveLength(1);
    expect(live[0].pairingCodePrefix).toBe(second.code.slice(0, 4));

    // The FIRST code must now fail to redeem: its row is revoked.
    const firstRedeem = await redeemPairingCode(adapter, first.code);
    expect(firstRedeem).toBe('unknown');

    // The SECOND — the one actually left live — must redeem successfully.
    const secondRedeem = await redeemPairingCode(adapter, second.code);
    if (typeof secondRedeem !== 'object') throw new Error(`expected a token, got ${secondRedeem}`);
    expect(secondRedeem.token).toMatch(/^srt_/);
  });

  it(
    'leaves an active, enrolled register active, with its existing device token still working, ' +
      'when a fresh pairing code is generated',
    async () => {
      const adapter = fakeAdapter();
      adapter.addRegister('r1', 'pending');
      const firstCode = await issuePairingCode(adapter, 'r1', 'u1');
      if (typeof firstCode !== 'object') throw new Error('expected a pairing code');
      const enrolled = await redeemPairingCode(adapter, firstCode.code);
      if (typeof enrolled !== 'object') throw new Error('expected a token');
      expect((await adapter.getRegisterById('r1'))!.status).toBe('active');

      // Generating a fresh code for a register that is already trading on an
      // enrolled device — the regression this whole change exists to fix.
      const secondCode = await issuePairingCode(adapter, 'r1', 'u1');
      expect(typeof secondCode).toBe('object');

      // The register must still be active...
      expect((await adapter.getRegisterById('r1'))!.status).toBe('active');
      // ...and the OLD device's token must still authenticate.
      const stillWorks = await verifyDeviceToken(adapter, enrolled.token);
      if (typeof stillWorks !== 'object') throw new Error(`expected the token to still work, got ${stillWorks}`);
      expect(stillWorks.register.id).toBe('r1');
    }
  );
});

describe('redeemPairingCode', () => {
  it('refuses an unknown code', async () => {
    const adapter = fakeAdapter();

    const result = await redeemPairingCode(adapter, 'ZZZZ9999');

    expect(result).toBe('unknown');
  });

  it('mints a token and activates the register on success', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');

    const result = await redeemPairingCode(adapter, issued.code);

    if (typeof result !== 'object') throw new Error(`expected a token, got ${result}`);
    expect(result.token).toMatch(/^srt_[0-9a-f]{8}_[0-9a-f]{32,}$/);
    expect(result.register.status).toBe('active');
  });

  it('a code cannot be redeemed twice', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');

    const firstRedeem = await redeemPairingCode(adapter, issued.code);
    expect(typeof firstRedeem).toBe('object');

    const secondRedeem = await redeemPairingCode(adapter, issued.code);
    expect(secondRedeem).toBe('already_redeemed');
  });

  it('an expired code is refused', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');

    // Reach into the fake store and back-date the expiry, rather than
    // waiting 15 real minutes or mocking Date.now() globally.
    for (const row of adapter.credentials.values()) {
      if (row.registerId === 'r1') row.pairingExpiresAt = Date.now() - 1000;
    }

    const result = await redeemPairingCode(adapter, issued.code);

    expect(result).toBe('expired');
  });

  it('refuses a retired register even with a valid, unexpired code', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');

    await adapter.setRegisterStatus('r1', 'retired');

    const result = await redeemPairingCode(adapter, issued.code);

    expect(result).toBe('retired');
  });

  it('redeeming a fresh code invalidates the previously enrolled token and installs the new one', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const firstCode = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof firstCode !== 'object') throw new Error('expected a pairing code');
    const firstEnrolment = await redeemPairingCode(adapter, firstCode.code);
    if (typeof firstEnrolment !== 'object') throw new Error('expected a token');

    // Generated but not yet redeemed: the old token must still be untouched.
    const secondCode = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof secondCode !== 'object') throw new Error('expected a pairing code');
    expect(await verifyDeviceToken(adapter, firstEnrolment.token)).not.toBe('revoked');

    // Redeeming is the hand-over: the old device stops working the instant
    // the new one starts.
    const secondEnrolment = await redeemPairingCode(adapter, secondCode.code);
    if (typeof secondEnrolment !== 'object') throw new Error('expected a token');
    expect(secondEnrolment.register.status).toBe('active');

    expect(await verifyDeviceToken(adapter, firstEnrolment.token)).toBe('revoked');
    const stillWorks = await verifyDeviceToken(adapter, secondEnrolment.token);
    if (typeof stillWorks !== 'object') throw new Error(`expected the new token to work, got ${stillWorks}`);
    expect(stillWorks.register.id).toBe('r1');
  });

  it('the token is bcrypt-hashed, never stored plainly', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');

    const result = await redeemPairingCode(adapter, issued.code);
    if (typeof result !== 'object') throw new Error(`expected a token, got ${result}`);

    const stored = [...adapter.credentials.values()].find((c) => c.registerId === 'r1')!;
    expect(stored.tokenHash).not.toBe(result.token);
    expect(stored.tokenHash).not.toContain(result.token);
    await expect(bcrypt.compare(result.token, stored.tokenHash!)).resolves.toBe(true);
  });
});

describe('verifyDeviceToken', () => {
  it('rejects an unknown token', async () => {
    const adapter = fakeAdapter();

    const result = await verifyDeviceToken(adapter, 'srt_deadbeef_notreal');

    expect(result).toBe('invalid');
  });

  it('accepts a freshly minted token', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');
    const redeemed = await redeemPairingCode(adapter, issued.code);
    if (typeof redeemed !== 'object') throw new Error('expected a token');

    const result = await verifyDeviceToken(adapter, redeemed.token);

    if (typeof result !== 'object') throw new Error(`expected a register, got ${result}`);
    expect(result.register.id).toBe('r1');
  });

  it('revoking then verifying the old token fails', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const issued = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof issued !== 'object') throw new Error('expected a pairing code');
    const redeemed = await redeemPairingCode(adapter, issued.code);
    if (typeof redeemed !== 'object') throw new Error('expected a token');

    const revoked = await revokeCredential(adapter, 'r1', { userId: 'admin', reason: 'lost device' });
    expect(revoked).not.toBe('not_found');

    const result = await verifyDeviceToken(adapter, redeemed.token);

    expect(result).toBe('revoked');
  });
});

describe('revokeCredential', () => {
  it('reports not_found for a register that does not exist', async () => {
    const adapter = fakeAdapter();

    const result = await revokeCredential(adapter, 'nope', { userId: 'admin' });

    expect(result).toBe('not_found');
  });

  it('returns the register to pending even when it had no live credential', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'active');

    const result = await revokeCredential(adapter, 'r1', { userId: 'admin' });

    if (result === 'not_found') throw new Error('expected a result');
    expect(result.credentials).toEqual([]);
    expect(result.register.status).toBe('pending');
  });

  it('destroys BOTH an enrolled token and a coexisting outstanding pairing code, not just one', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'pending');
    const firstCode = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof firstCode !== 'object') throw new Error('expected a pairing code');
    const enrolled = await redeemPairingCode(adapter, firstCode.code);
    if (typeof enrolled !== 'object') throw new Error('expected a token');

    // A register can legitimately be both enrolled AND mid re-pair at once.
    const outstandingCode = await issuePairingCode(adapter, 'r1', 'u1');
    if (typeof outstandingCode !== 'object') throw new Error('expected a pairing code');

    const result = await revokeCredential(adapter, 'r1', { userId: 'admin', reason: 'lost device' });
    if (result === 'not_found') throw new Error('expected a result');

    expect(result.credentials).toHaveLength(2);
    expect(result.register.status).toBe('pending');
    expect(await verifyDeviceToken(adapter, enrolled.token)).toBe('revoked');
    expect(await redeemPairingCode(adapter, outstandingCode.code)).toBe('unknown');
  });

  it('ends the register\'s open shift with reason "revoked" — a revoked till must not keep authorizing whoever is mid-shift on it', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'active');
    adapter.addOpenShift('s1', 'r1');

    const result = await revokeCredential(adapter, 'r1', { userId: 'admin', reason: 'lost device' });

    if (result === 'not_found') throw new Error('expected a result');
    const shift = adapter.shifts.get('s1')!;
    expect(shift.endedAt).not.toBeNull();
    expect(shift.endReason).toBe('revoked');
  });

  it('is a no-op on shifts when the register has none open', async () => {
    const adapter = fakeAdapter();
    adapter.addRegister('r1', 'active');

    const result = await revokeCredential(adapter, 'r1', { userId: 'admin' });

    if (result === 'not_found') throw new Error('expected a result');
    expect(adapter.shifts.size).toBe(0);
  });
});
