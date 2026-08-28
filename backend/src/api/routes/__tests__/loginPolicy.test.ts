import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const getUserByEmail = vi.fn();
const updateUserLastLogin = vi.fn();
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

const PASSWORD = 'DemoPass!1';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function user(roles: { systemRole: string }[]) {
  return {
    id: 'u1', email: 'someone@demo.local', name: 'Someone', status: 'active',
    passwordHash: HASH, orgId: '00000000-0000-0000-0000-000000000001',
    roleIds: roles.map((_, i) => `r${i}`),
    roles: roles.map((role, i) => ({ id: `r${i}`, name: role.systemRole, ...role })),
  };
}

const login = () =>
  request(app).post('/api/auth/login').send({ email: 'someone@demo.local', password: PASSWORD });

beforeEach(() => {
  vi.clearAllMocks();
  updateUserLastLogin.mockResolvedValue(undefined);
});

describe('who the password form accepts', () => {
  it.each([['admin'], ['supervisor'], ['reporter']])(
    'accepts %s, who needs the back office',
    async (systemRole) => {
      getUserByEmail.mockResolvedValue(user([{ systemRole }]));

      const response = await login();

      expect(response.status).toBe(200);
      expect(response.body.data.token).toEqual(expect.any(String));
    }
  );

  it('refuses a cashier and tells them where to go', async () => {
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }]));

    const response = await login();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('USE_PIN_AT_TILL');
    expect(response.body.error).toMatch(/PIN/i);
  });

  it('accepts someone who is a cashier AND a reporter', async () => {
    // "Every role is standard", not "any role is standard": a second role that
    // needs the back office is a reason to let them in.
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }, { systemRole: 'reporter' }]));

    const response = await login();

    expect(response.status).toBe(200);
  });

  it('refuses a user with no roles at all', async () => {
    getUserByEmail.mockResolvedValue(user([]));

    const response = await login();

    expect(response.status).toBe(403);
  });

  it('checks the password before the role, so it is not a cashier oracle', async () => {
    // Refusing on role first would let anyone discover which addresses belong
    // to cashiers without knowing a single password.
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }]));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@demo.local', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.code).not.toBe('USE_PIN_AT_TILL');
  });

  it('checks status before the role, so an inactive cashier reads as inactive', async () => {
    getUserByEmail.mockResolvedValue({ ...user([{ systemRole: 'standard' }]), status: 'suspended' });

    const response = await login();

    expect(response.body.code).not.toBe('USE_PIN_AT_TILL');
  });

  it('does not stamp a last-login for someone it turned away', async () => {
    getUserByEmail.mockResolvedValue(user([{ systemRole: 'standard' }]));

    await login();

    expect(updateUserLastLogin).not.toHaveBeenCalled();
  });
});
