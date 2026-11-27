import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';

/**
 * `authenticate` and `optionalAuth` called directly, for the branches the
 * route-level suites do not reach: expired and malformed tokens, suspended
 * users, no-PIN register principals, a shift on the wrong register, and the
 * whole of `optionalAuth`.
 */
const getUserByEmail = vi.fn();
const getRegisterShiftById = vi.fn();
const getOpenShiftForRegister = vi.fn();
const getRegisterById = vi.fn();
const touchRegisterShiftActivity = vi.fn();
const endRegisterShift = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getRegisterShiftById,
      getOpenShiftForRegister,
      getRegisterById,
      touchRegisterShiftActivity,
      endRegisterShift,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { authenticate, optionalAuth, DEFAULT_ORG_ID } = await import('../auth');
type Req = Parameters<typeof authenticate>[0];

const USER = {
  id: 'u1',
  email: 'cashier@example.com',
  status: 'active',
  orgId: 'org-from-db',
  roleIds: ['r1'],
  roles: [{ id: 'r1', name: 'Standard' }],
};

const sign = (claims: Record<string, unknown>, options: jwt.SignOptions = { expiresIn: '1h' }) =>
  jwt.sign({ id: 'u1', email: USER.email, roleIds: ['r1'], ...claims }, config.jwt.secret, options);

function reqWith(token?: string): Req {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as Req;
}

/** Run a middleware and return what it passed to `next`. */
async function run(mw: typeof authenticate, req: Req): Promise<unknown> {
  let passed: unknown = 'next-not-called';
  await mw(req, {} as Response, (err?: unknown) => {
    passed = err;
  });
  return passed;
}

const status401 = (message: string, code?: string) =>
  expect.objectContaining({ statusCode: 401, message, ...(code ? { code } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(USER);
  getRegisterById.mockResolvedValue({ id: 'reg1', status: 'active', idleLockSeconds: 300 });
});

describe('authenticate', () => {
  it('rejects a request with no bearer token', async () => {
    expect(await run(authenticate, reqWith())).toEqual(status401('Not authenticated'));
  });

  it('rejects an empty bearer token', async () => {
    const req = { headers: { authorization: 'Bearer   ' } } as unknown as Req;

    expect(await run(authenticate, req)).toEqual(status401('Not authenticated'));
  });

  it('reports an expired token as expired, not merely invalid', async () => {
    const token = sign({ exp: Math.floor(Date.now() / 1000) - 60 }, {});

    expect(await run(authenticate, reqWith(token))).toEqual(status401('Session expired'));
  });

  it('rejects a token signed with another secret', async () => {
    const forged = jwt.sign({ id: 'u1', email: USER.email }, 'not-the-secret');

    expect(await run(authenticate, reqWith(forged))).toEqual(status401('Not authenticated'));
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects a suspended user with the same 401 as an unknown one', async () => {
    getUserByEmail.mockResolvedValueOnce({ ...USER, status: 'suspended' });
    getUserByEmail.mockResolvedValueOnce(null);

    expect(await run(authenticate, reqWith(sign({})))).toEqual(status401('Not authenticated'));
    expect(await run(authenticate, reqWith(sign({})))).toEqual(status401('Not authenticated'));
  });

  it('takes the org from the database over the token, and roles from the database too', async () => {
    const req = reqWith(sign({ orgId: 'org-from-token' }));

    expect(await run(authenticate, req)).toBeUndefined();
    expect(req.orgId).toBe('org-from-db');
    expect(req.user).toEqual({ id: 'u1', email: USER.email, roleIds: ['r1'], roles: USER.roles });
    expect(req.tillSession).toBeUndefined();
  });

  it('falls back to the token’s org, then the default org, when the user row has none', async () => {
    getUserByEmail.mockResolvedValue({ ...USER, orgId: undefined, roleIds: undefined, roles: undefined });
    const withClaim = reqWith(sign({ orgId: 'org-from-token' }));
    const without = reqWith(sign({}));

    await run(authenticate, withClaim);
    await run(authenticate, without);

    expect(withClaim.orgId).toBe('org-from-token');
    expect(without.orgId).toBe(DEFAULT_ORG_ID);
    expect(without.user).toMatchObject({ roleIds: [], roles: [] });
  });

  it('builds a no-PIN register principal from the token without looking up a user', async () => {
    const req = reqWith(sign({ id: 'register:reg1', email: 'register:reg1', registerPrincipal: true, registerId: 'reg1' }));

    expect(await run(authenticate, req)).toBeUndefined();
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'register:reg1', email: 'register:reg1', roleIds: [], roles: [] });
    expect(req.orgId).toBe(DEFAULT_ORG_ID);
    expect(req.tillSession).toEqual({ shiftId: undefined, registerId: 'reg1', assumed: undefined });
  });

  it('refuses a register principal once its register is disabled', async () => {
    getRegisterById.mockResolvedValue({ id: 'reg1', status: 'disabled' });
    const req = reqWith(sign({ id: 'register:reg1', email: 'register:reg1', registerPrincipal: true, registerId: 'reg1' }));

    expect(await run(authenticate, req)).toEqual(status401('That register is no longer active', 'REGISTER_INACTIVE'));
  });

  it('refuses a shift token whose register claim is not the shift’s own register', async () => {
    const shift = { id: 's1', registerId: 'reg-real', endedAt: null, lastActivityAt: Date.now() };
    getRegisterShiftById.mockResolvedValue(shift);
    getOpenShiftForRegister.mockResolvedValue(shift);

    const result = await run(authenticate, reqWith(sign({ shiftId: 's1', registerId: 'reg-forged' })));

    expect(result).toEqual(status401('That shift has ended', 'SHIFT_ENDED'));
  });

  it('refuses a shift that no longer exists', async () => {
    getRegisterShiftById.mockResolvedValue(null);

    expect(await run(authenticate, reqWith(sign({ shiftId: 's-gone' })))).toEqual(
      status401('That shift has ended', 'SHIFT_ENDED')
    );
  });

  it('bumps the shift’s idle clock only once the throttle window has passed', async () => {
    const stale = { id: 's1', registerId: 'reg1', endedAt: null, lastActivityAt: Date.now() - 60_000 };
    const fresh = { ...stale, lastActivityAt: Date.now() };
    getRegisterShiftById.mockResolvedValue(stale);
    getOpenShiftForRegister.mockResolvedValueOnce(fresh).mockResolvedValueOnce(stale);
    touchRegisterShiftActivity.mockResolvedValue(stale);

    await run(authenticate, reqWith(sign({ shiftId: 's1', registerId: 'reg1' })));
    expect(touchRegisterShiftActivity).not.toHaveBeenCalled();

    await run(authenticate, reqWith(sign({ shiftId: 's1', registerId: 'reg1' })));
    expect(touchRegisterShiftActivity).toHaveBeenCalledWith('s1');
  });

  it('marks an assumed till session so /refresh can refuse to extend it', async () => {
    const req = reqWith(sign({ assumed: true, registerId: 'reg1' }));

    await run(authenticate, req);

    expect(req.tillSession).toEqual({ shiftId: undefined, registerId: 'reg1', assumed: true });
  });

  it('passes a database failure on as-is rather than reporting it as a 401', async () => {
    const boom = new Error('connection reset');
    getUserByEmail.mockRejectedValue(boom);

    expect(await run(authenticate, reqWith(sign({})))).toBe(boom);
  });
});

describe('optionalAuth', () => {
  it('lets an anonymous request through untouched', async () => {
    const req = reqWith();

    expect(await run(optionalAuth, req)).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('attaches the user for a valid token', async () => {
    const req = reqWith(sign({}));

    expect(await run(optionalAuth, req)).toBeUndefined();
    expect(req.user).toMatchObject({ id: 'u1', roles: USER.roles });
    expect(req.orgId).toBe('org-from-db');
  });

  it('leaves a suspended user anonymous rather than rejecting', async () => {
    getUserByEmail.mockResolvedValue({ ...USER, status: 'suspended' });
    const req = reqWith(sign({}));

    expect(await run(optionalAuth, req)).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('treats a bad or expired token as anonymous, never an error', async () => {
    const bad = reqWith('garbage.token.here');
    const expired = reqWith(sign({ exp: Math.floor(Date.now() / 1000) - 60 }, {}));

    expect(await run(optionalAuth, bad)).toBeUndefined();
    expect(await run(optionalAuth, expired)).toBeUndefined();
    expect(bad.user).toBeUndefined();
    expect(expired.user).toBeUndefined();
  });

  it('falls back to the default org when neither user nor token carries one', async () => {
    getUserByEmail.mockResolvedValue({ ...USER, orgId: undefined, roleIds: undefined, roles: undefined });
    const req = reqWith(sign({}));

    await run(optionalAuth, req);

    expect(req.orgId).toBe(DEFAULT_ORG_ID);
    expect(req.user).toMatchObject({ roleIds: [], roles: [] });
  });
});
