import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { verifyPasswordLogin } from '../passwordLockout';
import config from '../../config';

/**
 * The lockout that `POST /api/auth/login` had none of.
 *
 * `loginLimiter` counts per IP, so an attacker with a few hundred addresses had
 * effectively unlimited attempts against any one account — while the six-digit
 * PIN beside it locked after five. These assert the two properties that matter:
 * the counting actually happens, and a locked account is indistinguishable from
 * a wrong password unless the caller already knows the password.
 */

const PASSWORD = 'correct-horse-battery-staple';
let hash: string;

const recordPasswordFailure = vi.fn().mockResolvedValue(undefined);
const resetPasswordFailures = vi.fn().mockResolvedValue(undefined);
const createAuditLog = vi.fn().mockResolvedValue(undefined);

// Only the methods this service touches; it never resolves a user itself.
const adapter = { recordPasswordFailure, resetPasswordFailures, createAuditLog } as never;

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'admin@shop.example',
    passwordHash: hash,
    status: 'active',
    passwordFailedCount: 0,
    passwordLockedUntil: null,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  hash = hash ?? (await bcrypt.hash(PASSWORD, 10));
});

describe('verifyPasswordLogin', () => {
  it('admits the right password and clears the counter', async () => {
    const result = await verifyPasswordLogin(adapter, account({ passwordFailedCount: 3 }), PASSWORD);

    expect(result.outcome).toBe('ok');
    // Only a clean success clears it. A partial run of failures should not
    // survive a correct sign-in.
    expect(resetPasswordFailures).toHaveBeenCalledWith('u1');
    expect(recordPasswordFailure).not.toHaveBeenCalled();
  });

  it('counts a wrong password without locking, below the threshold', async () => {
    const result = await verifyPasswordLogin(adapter, account({ passwordFailedCount: 2 }), 'wrong');

    expect(result.outcome).toBe('invalid');
    expect(recordPasswordFailure).toHaveBeenCalledWith('u1', {
      failedCount: 3,
      lockedUntil: null,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('locks on the configured failure, and audits it', async () => {
    const last = config.security.passwordMaxFailures - 1;
    const before = Date.now();

    const result = await verifyPasswordLogin(adapter, account({ passwordFailedCount: last }), 'wrong');

    // Still just "invalid" to the caller: the lockout must not announce itself
    // to somebody guessing.
    expect(result.outcome).toBe('invalid');

    const [, payload] = recordPasswordFailure.mock.calls[0];
    expect(payload.failedCount).toBe(config.security.passwordMaxFailures);
    expect(payload.lockedUntil).toBeGreaterThanOrEqual(before + config.security.passwordLockoutMs);

    // A lockout is a security event with no authenticated actor, so it is
    // written straight to the adapter with a null userId — same as the PIN one.
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    const entry = createAuditLog.mock.calls[0][0];
    expect(entry.userId).toBeNull();
    expect(entry.entityId).toBe('u1');
    expect(entry.after.reason).toBe('password_lockout');
  });

  it('refuses a locked account even with the right password', async () => {
    const until = Date.now() + 60_000;
    const result = await verifyPasswordLogin(
      adapter,
      account({ passwordLockedUntil: until }),
      PASSWORD
    );

    // A lockout the correct password walks through protects nothing — a
    // successful guess is precisely what it exists to prevent.
    expect(result).toEqual({ outcome: 'locked', until });
    expect(resetPasswordFailures).not.toHaveBeenCalled();
  });

  it('tells a locked account nothing when the password is also wrong', async () => {
    const result = await verifyPasswordLogin(
      adapter,
      account({ passwordLockedUntil: Date.now() + 60_000 }),
      'wrong'
    );

    // "Locked" would confirm the address exists — the same enumeration leak the
    // decoy comparison closes on the timing side.
    expect(result).toEqual({ outcome: 'invalid' });
  });

  it('does not extend a lockout on further wrong guesses', async () => {
    await verifyPasswordLogin(
      adapter,
      account({ passwordLockedUntil: Date.now() + 60_000, passwordFailedCount: 99 }),
      'wrong'
    );

    // Otherwise an attacker could hold somebody's account shut indefinitely by
    // failing once a minute forever.
    expect(recordPasswordFailure).not.toHaveBeenCalled();
  });

  it('lets an expired lockout through', async () => {
    const result = await verifyPasswordLogin(
      adapter,
      account({ passwordLockedUntil: Date.now() - 1, passwordFailedCount: 99 }),
      PASSWORD
    );

    expect(result.outcome).toBe('ok');
    expect(resetPasswordFailures).toHaveBeenCalledWith('u1');
  });

  it('treats a Date from the adapter the same as epoch milliseconds', async () => {
    // Postgres returns a timestamp, SQLite an integer. A service that only
    // understood one would silently never lock on the other.
    const until = Date.now() + 60_000;
    const result = await verifyPasswordLogin(
      adapter,
      account({ passwordLockedUntil: new Date(until) }),
      PASSWORD
    );

    expect(result).toEqual({ outcome: 'locked', until });
  });

  it('answers a missing account exactly as a wrong password', async () => {
    const result = await verifyPasswordLogin(adapter, null, 'anything');

    expect(result).toEqual({ outcome: 'invalid' });
    expect(recordPasswordFailure).not.toHaveBeenCalled();
  });

  it('fails closed on a row with no usable hash', async () => {
    const result = await verifyPasswordLogin(adapter, account({ passwordHash: null }), 'anything');

    expect(result).toEqual({ outcome: 'invalid' });
  });

  it('spends real work on a missing account, so timing says nothing', async () => {
    // The property #49 established for the route, now owned by this service.
    await verifyPasswordLogin(adapter, null, 'warmup');

    const started = process.hrtime.bigint();
    await verifyPasswordLogin(adapter, null, 'anything');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    // A bcrypt verify is tens of milliseconds; returning early is microseconds.
    expect(elapsedMs).toBeGreaterThan(10);
  });
});
