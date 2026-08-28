import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getUserByEmail = vi.fn();
const updateUserLastLogin = vi.fn().mockResolvedValue(undefined);
// Lockout bookkeeping (services/passwordLockout.ts). Every login test needs
// these on the mock: the login route calls one of them on every attempt, and a
// mock without them fails as a 500 rather than as the 401 the test is about.
const recordPasswordFailure = vi.fn().mockResolvedValue(undefined);
const resetPasswordFailures = vi.fn().mockResolvedValue(undefined);
const createAuditLog = vi.fn().mockResolvedValue(undefined);


vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      updateUserLastLogin,
      recordPasswordFailure,
      resetPasswordFailures,
      createAuditLog,
    }),
  },
}));

const { default: app } = await import('../../../app');

/**
 * The login endpoint must not answer faster for an address it has never seen.
 *
 * A wrong password costs a bcrypt verification. An unknown address used to cost
 * a database miss and nothing else, so the two answers - identical in every
 * respect a client can read - took visibly different amounts of time. That is a
 * user-enumeration oracle: slow means "this account exists".
 *
 * Timing tests are flaky if written as "A is within N ms of B", so this asserts
 * the shape of the thing instead: the unknown-address path must spend real work
 * (a bcrypt at the configured cost is tens of milliseconds; a lookup miss is
 * microseconds), and the two paths must land within the same order of
 * magnitude. Wide bounds, because CI machines are noisy - the regression this
 * catches is the gap reopening to ~100x, not drifting by 20%.
 */

const PASSWORD = 'correct-horse-battery-staple';

beforeEach(() => {
  vi.clearAllMocks();
});

async function timeOf(fn: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function attempt(email: string) {
  return request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
}

describe('POST /api/auth/login timing', () => {
  it('refuses an unknown address and a wrong password identically', async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);

    getUserByEmail.mockResolvedValue(null);
    const unknown = await attempt('nobody@example.com');

    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      name: 'Admin',
      status: 'active',
      passwordHash: hash,
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
    });
    const wrongPassword = await attempt('admin@example.com');

    // Same status, same body: the response itself gives nothing away, which is
    // the premise the timing check below is protecting.
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  it('spends real work on an address that does not exist', async () => {
    getUserByEmail.mockResolvedValue(null);

    // Warm the lazily-built decoy hash so the first call's one-off cost is not
    // what this measures.
    await attempt('warmup@example.com');

    const elapsed = await timeOf(() => attempt('nobody@example.com'));

    // A bcrypt verify at cost 10 is ~30-100ms; a bare lookup miss is well under
    // 1ms. Ten is far below the former and far above the latter.
    expect(elapsed).toBeGreaterThan(10);
  });

  it('keeps the two refusals within the same order of magnitude', async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const knownUser = {
      id: 'u1',
      email: 'admin@example.com',
      name: 'Admin',
      status: 'active',
      passwordHash: hash,
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
    };

    getUserByEmail.mockResolvedValue(null);
    await attempt('warmup@example.com');

    // Interleaved and averaged: a single sample of each would mostly measure
    // whatever else the machine was doing at that instant.
    const unknownSamples: number[] = [];
    const wrongSamples: number[] = [];
    for (let i = 0; i < 3; i++) {
      getUserByEmail.mockResolvedValue(null);
      unknownSamples.push(await timeOf(() => attempt(`nobody${i}@example.com`)));

      getUserByEmail.mockResolvedValue(knownUser);
      wrongSamples.push(await timeOf(() => attempt('admin@example.com')));
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ratio = mean(wrongSamples) / mean(unknownSamples);

    // Before the decoy, this ratio was in the hundreds. Anything under 5 means
    // the branches are doing comparable work.
    expect(ratio).toBeLessThan(5);
    expect(ratio).toBeGreaterThan(0.2);
  });
});
