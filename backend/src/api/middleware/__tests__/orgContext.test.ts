import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Tenant context on a request.
 *
 * Nothing scopes queries by it yet — see docs/guides/multi-tenant.md for why
 * the column and the filtering land separately. What matters now is that
 * `req.orgId` is always populated, so the code that eventually reads it never
 * has to decide what an absent tenant means.
 */
const getUserByEmail = vi.fn();
const getAllProducts = vi.fn();
const updateUserLastLogin = vi.fn();
// Lockout bookkeeping (services/passwordLockout.ts). Every login test needs
// these on the mock: the login route calls one of them on every attempt, and a
// mock without them fails as a 500 rather than as the 401 the test is about.
const recordPasswordFailure = vi.fn().mockResolvedValue(undefined);
const resetPasswordFailures = vi.fn().mockResolvedValue(undefined);

const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllProducts,
      updateUserLastLogin,
      createAuditLog,
      recordPasswordFailure,
      resetPasswordFailures,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../auth');
const { default: app } = await import('../../../app');

const OTHER_ORG = '11111111-1111-1111-1111-111111111111';

function token(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    { id: 'u1', email: 'admin@example.com', roleIds: ['r1'], ...claims },
    config.jwt.secret,
    { expiresIn: '1h' }
  );
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(user());
  getAllProducts.mockImplementation(async () => ({ products: [], total: 0 }));
  updateUserLastLogin.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue({});
});

/**
 * What `authenticate` put on the request, observed rather than asserted about.
 *
 * `POST /api/auth/refresh` runs `authenticate` and then signs `req.orgId` into
 * the token it returns, so decoding that token reports the actual value the
 * middleware resolved.
 */
async function resolvedOrgId(bearer: string): Promise<string | undefined> {
  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Authorization', `Bearer ${bearer}`);

  expect(response.status).toBe(200);
  return (jwt.decode(response.body.data.token) as { orgId?: string }).orgId;
}

describe('req.orgId', () => {
  it('falls back to the default org when the user has none', async () => {
    // Every row predating migration 014 has a null org_id. Leaving `orgId`
    // undefined would push that decision onto every future consumer.
    getUserByEmail.mockResolvedValue(user({ orgId: null }));

    expect(await resolvedOrgId(token())).toBe(DEFAULT_ORG_ID);
  });

  it('accepts a token minted before orgs existed', async () => {
    // No `orgId` claim at all — these are live in the wild until they expire.
    expect(await resolvedOrgId(token())).toBe(DEFAULT_ORG_ID);
  });

  it('prefers the stored org over the token claim', async () => {
    // Same reason roles are reloaded per request: a token outlives a change,
    // and moving a user between orgs should not wait for it to expire.
    getUserByEmail.mockResolvedValue(user({ orgId: OTHER_ORG }));

    expect(await resolvedOrgId(token({ orgId: DEFAULT_ORG_ID }))).toBe(OTHER_ORG);
  });

  it('uses the token claim when the user record carries none', async () => {
    getUserByEmail.mockResolvedValue(user({ orgId: null }));

    expect(await resolvedOrgId(token({ orgId: OTHER_ORG }))).toBe(OTHER_ORG);
  });
});

describe('POST /api/auth/login', () => {
  it('carries the org into the token', async () => {
    const { default: bcrypt } = await import('bcryptjs');
    getUserByEmail.mockResolvedValue(
      user({ passwordHash: await bcrypt.hash('DemoPass!1', 4), orgId: OTHER_ORG })
    );

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'DemoPass!1' });

    expect(response.status).toBe(200);
    const claims = jwt.decode(response.body.data.token) as { orgId?: string };
    expect(claims.orgId).toBe(OTHER_ORG);
  });

  it('defaults the claim when the user has no org', async () => {
    const { default: bcrypt } = await import('bcryptjs');
    getUserByEmail.mockResolvedValue(
      user({ passwordHash: await bcrypt.hash('DemoPass!1', 4), orgId: null })
    );

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'DemoPass!1' });

    const claims = jwt.decode(response.body.data.token) as { orgId?: string };
    expect(claims.orgId).toBe(DEFAULT_ORG_ID);
  });
});
