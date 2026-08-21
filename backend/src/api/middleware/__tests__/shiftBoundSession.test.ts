import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getUserByEmail = vi.fn();
const getOpenShiftForRegister = vi.fn();
const getRegisterById = vi.fn();
const endRegisterShift = vi.fn();
const getRegisterShiftById = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getOpenShiftForRegister,
      getRegisterById,
      endRegisterShift,
      getRegisterShiftById,
      getAllProducts: vi.fn(async () => ({ products: [], total: 0 })),
    }),
  },
}));

const { default: app } = await import('../../../app');
const { mintSession } = await import('../../../services/tillSessions');

const USER = {
  id: 'u1',
  email: 'cashier@demo.local',
  name: 'Cashier',
  status: 'active',
  orgId: '00000000-0000-0000-0000-000000000001',
  roleIds: ['r1'],
  roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions: { inventory: { read: true } } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(USER);
  getRegisterById.mockResolvedValue({ id: 'reg1', status: 'active', idleLockSeconds: 300, orgId: USER.orgId });
});

/**
 * Any authenticated GET will do. Pick one that needs only a permission USER
 * actually has — verify which route that is before relying on it, and adjust
 * both PROBE and USER.roles together if `/api/products` needs something else.
 */
const PROBE = '/api/products';

describe('a shift-bound session', () => {
  it('authorizes a request while its shift is open', async () => {
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
    });
    getOpenShiftForRegister.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('is refused once the shift has ended', async () => {
    // The whole point: signing out must not leave a working token behind.
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: Date.now(), lastActivityAt: Date.now(),
    });
    getOpenShiftForRegister.mockResolvedValue(null);
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SHIFT_ENDED');
  });

  it('is refused once the shift has been idle past the register window', async () => {
    // No explicit end call: idle expiry is decided lazily on read, by
    // getOpenShift, which ends the row itself and returns null.
    const idle = { id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now() - 400_000 };
    getRegisterShiftById.mockResolvedValue(idle);
    getOpenShiftForRegister.mockResolvedValue(idle);
    endRegisterShift.mockResolvedValue({ ...idle, endedAt: Date.now(), endReason: 'idle_timeout' });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SHIFT_ENDED');
    // Proves the check went through getOpenShift rather than reading endedAt.
    expect(endRegisterShift).toHaveBeenCalledWith('s1', 'idle_timeout');
  });

  it('is refused when the shift no longer exists', async () => {
    getRegisterShiftById.mockResolvedValue(null);
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('is refused when a different shift is now open on that till', async () => {
    // Superseded: another cashier PINned in. The old token names a shift that
    // is no longer the open one.
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: Date.now(), lastActivityAt: Date.now(),
    });
    getOpenShiftForRegister.mockResolvedValue({
      id: 's2', registerId: 'reg1', userId: 'u2', endedAt: null, lastActivityAt: Date.now(),
    });
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('a no-PIN till session', () => {
  it('authorizes while its register is active', async () => {
    const { token } = mintSession({ user: USER, registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(getRegisterShiftById).not.toHaveBeenCalled();
  });

  it('is refused once its register is no longer active', async () => {
    getRegisterById.mockResolvedValue({ id: 'reg1', status: 'retired', idleLockSeconds: 300, orgId: USER.orgId });
    const { token } = mintSession({ user: USER, registerId: 'reg1' });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('a password session', () => {
  it('takes none of the shift path', async () => {
    const { token } = mintSession({ user: USER });

    const response = await request(app).get(PROBE).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(getRegisterShiftById).not.toHaveBeenCalled();
    expect(getRegisterById).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/refresh', () => {
  it('carries the shift binding into the refreshed token', async () => {
    // Without this, refresh launders a till session into one that never ends —
    // and auth-store refreshes on a timer, so it would happen unprompted.
    const open = { id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now() };
    getRegisterShiftById.mockResolvedValue(open);
    getOpenShiftForRegister.mockResolvedValue(open);
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('refuses to refresh a session whose shift has ended', async () => {
    getRegisterShiftById.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: Date.now(), lastActivityAt: Date.now(),
    });
    getOpenShiftForRegister.mockResolvedValue(null);
    const { token } = mintSession({ user: USER, shiftId: 's1', registerId: 'reg1' });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('leaves a password session unbound', async () => {
    const { token } = mintSession({ user: USER });

    const response = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    const [, payload] = String(response.body.data.token).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString());
    expect('shiftId' in claims).toBe(false);
  });
});
