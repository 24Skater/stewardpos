import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Guard tests: who may reach a protected route, and with what permission.
 *
 * The database is stubbed so these stay route-level - the questions here are
 * about middleware, not storage.
 */
const getUserByEmail = vi.fn();
const getAllProducts = vi.fn();
const getAllServices = vi.fn();
const deleteProduct = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getAllProducts, getAllServices, deleteProduct }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

type Perms = Record<string, { read?: boolean; write?: boolean; delete?: boolean }>;

function tokenFor(email = 'staff@example.com'): string {
  return jwt.sign({ id: 'user-1', email, roleIds: ['role-1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'staff@example.com',
    name: 'Staff',
    status: 'active',
    roleIds: ['role-1'],
    roles: [{ id: 'role-1', name: 'Standard', systemRole: 'standard', permissions: {} as Perms }],
    ...overrides,
  };
}

function withPermissions(permissions: Perms) {
  return user({
    roles: [{ id: 'role-1', name: 'Standard', systemRole: 'standard', permissions }],
  });
}

const admin = () =>
  user({ roles: [{ id: 'role-0', name: 'Admin', systemRole: 'admin', permissions: {} as Perms }] });

beforeEach(() => {
  vi.clearAllMocks();
  getAllProducts.mockResolvedValue([]);
  getAllServices.mockResolvedValue([]);
  deleteProduct.mockResolvedValue(true);
});

describe('authenticate', () => {
  it('rejects an anonymous request to the catalog', async () => {
    const response = await request(app).get('/api/products');

    expect(response.status).toBe(401);
    expect(getAllProducts).not.toHaveBeenCalled();
  });

  it('rejects the service catalog anonymously too', async () => {
    expect((await request(app).get('/api/services')).status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ id: 'user-1', email: 'staff@example.com', roleIds: [] }, 'not-the-secret');

    const response = await request(app).get('/api/products').set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    getUserByEmail.mockResolvedValue(admin());
    const expired = jwt.sign(
      { id: 'user-1', email: 'staff@example.com', roleIds: [] },
      config.jwt.secret,
      { expiresIn: '-1s' }
    );

    const response = await request(app).get('/api/products').set('Authorization', `Bearer ${expired}`);

    expect(response.status).toBe(401);
  });

  it('rejects a still-valid token whose user has been deactivated', async () => {
    // The token is cryptographically fine; the account behind it is not. Trusting
    // the claims alone would leave a suspended user working until expiry.
    getUserByEmail.mockResolvedValue(user({ status: 'inactive' }));

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(401);
    expect(getAllProducts).not.toHaveBeenCalled();
  });

  it('rejects a token whose user no longer exists', async () => {
    getUserByEmail.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(401);
  });

  it('does not reveal which of those cases occurred', async () => {
    getUserByEmail.mockResolvedValue(null);
    const unknownUser = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    getUserByEmail.mockResolvedValue(user({ status: 'inactive' }));
    const suspended = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    const anonymous = await request(app).get('/api/products');

    expect(suspended.body.error ?? suspended.body.message).toBe(
      unknownUser.body.error ?? unknownUser.body.message
    );
    expect(anonymous.body.error ?? anonymous.body.message).toBe(
      unknownUser.body.error ?? unknownUser.body.message
    );
  });
});

describe('requirePermission', () => {
  it('allows a caller holding the exact permission', async () => {
    getUserByEmail.mockResolvedValue(withPermissions({ inventory: { read: true } }));

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(getAllProducts).toHaveBeenCalled();
  });

  it('refuses a caller without it', async () => {
    getUserByEmail.mockResolvedValue(withPermissions({ inventory: { read: false } }));

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
    expect(getAllProducts).not.toHaveBeenCalled();
  });

  it('does not let read imply delete', async () => {
    getUserByEmail.mockResolvedValue(
      withPermissions({ inventory: { read: true, write: true, delete: false } })
    );

    const response = await request(app)
      .delete('/api/products/p1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it('does not let a permission on one resource carry to another', async () => {
    getUserByEmail.mockResolvedValue(withPermissions({ inventory: { read: true } }));

    const response = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
  });

  it('lets an admin through without an explicit grant', async () => {
    getUserByEmail.mockResolvedValue(admin());

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
  });

  it('unions permissions across a user\'s roles', async () => {
    getUserByEmail.mockResolvedValue(
      user({
        roles: [
          { id: 'r1', name: 'Cashier', systemRole: 'standard', permissions: { inventory: { read: false } } },
          { id: 'r2', name: 'Stock', systemRole: 'standard', permissions: { inventory: { read: true } } },
        ],
      })
    );

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
  });

  it('refuses a user with no roles at all', async () => {
    getUserByEmail.mockResolvedValue(user({ roles: [], roleIds: [] }));

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
  });
});

describe('unauthenticated surface', () => {
  it('keeps health open', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
