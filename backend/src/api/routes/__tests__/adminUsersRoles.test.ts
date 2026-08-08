import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/**
 * User and role management.
 *
 * This is who can do what in the store. Two properties matter most: a password
 * is hashed before it reaches the adapter, and permissions are validated as a
 * complete shape rather than accepted piecemeal — a role saved with a missing
 * resource would read as denied everywhere and lock someone out of a job they
 * are supposed to be able to do.
 */
const getUserByEmail = vi.fn();
const getAllUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
const deleteUser = vi.fn();
const getAllRoles = vi.fn();
const createRole = vi.fn();
const updateRole = vi.fn();
const deleteRole = vi.fn();
const getAuditLogs = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllUsers,
      createUser,
      updateUser,
      deleteUser,
      getAllRoles,
      createRole,
      updateRole,
      deleteRole,
      getAuditLogs,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const PERSON = { id: 'u2', name: 'Cashier', email: 'cashier@example.com' };

/** Every resource, since the schema requires the complete shape. */
const FULL_PERMISSIONS = Object.fromEntries(
  ['inventory', 'reports', 'exports', 'settings', 'users', 'services', 'customers', 'orders', 'returns', 'discounts'].map(
    (resource) => [resource, { read: true, write: false, delete: false }]
  )
);

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Manager', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  // Audit lives behind `settings.read`, not `users.read`, so the default actor
  // needs both to exercise everything in this file.
  getUserByEmail.mockResolvedValue(
    actor({ users: { read: true, write: true, delete: true }, settings: { read: true } })
  );
  getAllUsers.mockResolvedValue([PERSON]);
  createUser.mockResolvedValue(PERSON);
  updateUser.mockResolvedValue(PERSON);
  deleteUser.mockResolvedValue(true);
  getAllRoles.mockResolvedValue([{ id: 'r1', name: 'Manager' }]);
  createRole.mockResolvedValue({ id: 'r2', name: 'Bench' });
  updateRole.mockResolvedValue({ id: 'r1', name: 'Renamed' });
  deleteRole.mockResolvedValue(true);
  getAuditLogs.mockResolvedValue([{ id: 'a1', action: 'create' }]);
  createAuditLog.mockResolvedValue({});
});

describe('POST /api/admin/users', () => {
  const body = {
    name: 'Cashier',
    email: 'cashier@example.com',
    password: 'CorrectHorse1',
    roleIds: ['r1'],
  };

  it('creates one', async () => {
    expect((await request(app).post('/api/admin/users').set(auth()).send(body)).status).toBe(201);
  });

  it('hashes the password and never passes the plaintext on', async () => {
    await request(app).post('/api/admin/users').set(auth()).send(body);

    const stored = createUser.mock.calls[0][0];
    expect(stored.password).toBeUndefined();
    expect(stored.passwordHash).not.toBe(body.password);
    expect(await bcrypt.compare(body.password, String(stored.passwordHash))).toBe(true);
  });

  it('never echoes the password back', async () => {
    const response = await request(app).post('/api/admin/users').set(auth()).send(body);

    expect(JSON.stringify(response.body)).not.toContain(body.password);
  });

  it('rejects a short password', async () => {
    const response = await request(app)
      .post('/api/admin/users')
      .set(auth())
      .send({ ...body, password: 'short' });

    expect(response.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    expect(
      (await request(app).post('/api/admin/users').set(auth()).send({ ...body, email: 'nope' })).status
    ).toBe(400);
  });

  it('refuses an account with no role at all', async () => {
    // A user with no roles can sign in and do nothing, which reads as a broken
    // account rather than a deliberate one.
    const response = await request(app)
      .post('/api/admin/users')
      .set(auth())
      .send({ ...body, roleIds: [] });

    expect(response.status).toBe(400);
  });

  it('needs users.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ users: { read: true, write: false } }));

    expect((await request(app).post('/api/admin/users').set(auth()).send(body)).status).toBe(403);
  });
});

describe('PUT /api/admin/users/:id', () => {
  it('updates without requiring a password', async () => {
    await request(app).put('/api/admin/users/u2').set(auth()).send({ name: 'Renamed' });

    expect(updateUser).toHaveBeenCalledWith('u2', expect.objectContaining({ name: 'Renamed' }));
  });

  it('hashes a new password when one is given', async () => {
    await request(app).put('/api/admin/users/u2').set(auth()).send({ password: 'NewPassw0rd' });

    const stored = updateUser.mock.calls[0][1];
    expect(await bcrypt.compare('NewPassw0rd', String(stored.passwordHash))).toBe(true);
  });

  it('404s for a user that does not exist', async () => {
    updateUser.mockResolvedValue(null);

    expect(
      (await request(app).put('/api/admin/users/nope').set(auth()).send({ name: 'X' })).status
    ).toBe(404);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('deletes one', async () => {
    expect((await request(app).delete('/api/admin/users/u2').set(auth())).status).toBe(200);
  });

  it('404s when there is nothing to delete', async () => {
    deleteUser.mockResolvedValue(false);

    expect((await request(app).delete('/api/admin/users/u2').set(auth())).status).toBe(404);
  });

  it('needs users.delete, not merely write', async () => {
    getUserByEmail.mockResolvedValue(actor({ users: { read: true, write: true, delete: false } }));

    expect((await request(app).delete('/api/admin/users/u2').set(auth())).status).toBe(403);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('roles', () => {
  it('lists them', async () => {
    expect((await request(app).get('/api/admin/roles').set(auth())).body.data).toHaveLength(1);
  });

  it('creates one with a complete permission set', async () => {
    const response = await request(app)
      .post('/api/admin/roles')
      .set(auth())
      .send({ name: 'Bench', permissions: FULL_PERMISSIONS });

    expect(response.status).toBe(201);
  });

  it('refuses a permission set missing a resource', async () => {
    // Accepted piecemeal, the missing resource reads as denied everywhere and
    // locks someone out of work they are supposed to be able to do — with
    // nothing on screen to say why.
    const { orders: _dropped, ...incomplete } = FULL_PERMISSIONS;

    const response = await request(app)
      .post('/api/admin/roles')
      .set(auth())
      .send({ name: 'Bench', permissions: incomplete });

    expect(response.status).toBe(400);
    expect(createRole).not.toHaveBeenCalled();
  });

  it('rejects an unknown system role', async () => {
    const response = await request(app)
      .post('/api/admin/roles')
      .set(auth())
      .send({ name: 'Bench', systemRole: 'superuser', permissions: FULL_PERMISSIONS });

    expect(response.status).toBe(400);
  });

  it('requires a name', async () => {
    expect(
      (await request(app).post('/api/admin/roles').set(auth()).send({ permissions: FULL_PERMISSIONS }))
        .status
    ).toBe(400);
  });

  it('needs users.delete to remove one', async () => {
    getUserByEmail.mockResolvedValue(actor({ users: { read: true, write: true, delete: false } }));

    expect((await request(app).delete('/api/admin/roles/r1').set(auth())).status).toBe(403);
  });
});

describe('GET /api/admin/audit', () => {
  it('returns the log', async () => {
    const response = await request(app).get('/api/admin/audit').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('is gated on settings.read, not users.read', async () => {
    getUserByEmail.mockResolvedValue(
      actor({ users: { read: true, write: true, delete: true }, settings: { read: false } })
    );

    expect((await request(app).get('/api/admin/audit').set(auth())).status).toBe(403);
  });
});
