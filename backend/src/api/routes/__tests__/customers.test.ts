import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Customer routes: validation, permissions, and the delete paths.
 *
 * Deleting a customer is the interesting part. It can fail on a foreign key —
 * they have orders, quotes, or returns — and the route turns that into an
 * explanation rather than a 500, because "cannot delete" with no reason leaves
 * a shop nothing to act on.
 */
const getUserByEmail = vi.fn();
const getAllCustomers = vi.fn();
const getCustomerById = vi.fn();
const createCustomer = vi.fn();
const updateCustomer = vi.fn();
const deleteCustomer = vi.fn();
const archiveCustomer = vi.fn();
const permanentDeleteCustomer = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllCustomers,
      getCustomerById,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      archiveCustomer,
      permanentDeleteCustomer,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const BUYER = { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' };

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
    roles: [{ id: 'r1', name: 'Desk', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ customers: { read: true, write: true, delete: true } }));
  getAllCustomers.mockResolvedValue([BUYER]);
  getCustomerById.mockResolvedValue(BUYER);
  createCustomer.mockResolvedValue(BUYER);
  updateCustomer.mockResolvedValue(BUYER);
  deleteCustomer.mockResolvedValue(true);
  archiveCustomer.mockResolvedValue({ ...BUYER, archived: true });
  permanentDeleteCustomer.mockResolvedValue(true);
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/customers', () => {
  it('lists them', async () => {
    const response = await request(app).get('/api/customers').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('needs customers.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ customers: { read: false } }));

    expect((await request(app).get('/api/customers').set(auth())).status).toBe(403);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns one', async () => {
    expect((await request(app).get('/api/customers/c1').set(auth())).body.data.id).toBe('c1');
  });

  it('404s when there is none', async () => {
    getCustomerById.mockResolvedValue(null);

    expect((await request(app).get('/api/customers/nope').set(auth())).status).toBe(404);
  });
});

describe('POST /api/customers', () => {
  it('creates one', async () => {
    const response = await request(app)
      .post('/api/customers')
      .set(auth())
      .send({ name: 'Ada Lovelace', email: 'ada@example.com' });

    expect(response.status).toBe(201);
    expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada Lovelace' }));
  });

  it('requires a name', async () => {
    const response = await request(app).post('/api/customers').set(auth()).send({ email: 'a@b.com' });

    expect(response.status).toBe(400);
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/customers')
      .set(auth())
      .send({ name: 'Ada', email: 'not-an-address' });

    expect(response.status).toBe(400);
  });

  it('accepts an empty email, which is not the same as a bad one', async () => {
    // A walk-in customer has a name and no address; refusing that would make
    // the field mandatory in practice.
    const response = await request(app)
      .post('/api/customers')
      .set(auth())
      .send({ name: 'Walk In', email: '' });

    expect(response.status).toBe(201);
  });

  it('needs customers.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ customers: { read: true, write: false } }));

    expect(
      (await request(app).post('/api/customers').set(auth()).send({ name: 'Ada' })).status
    ).toBe(403);
  });
});

describe('PUT /api/customers/:id', () => {
  it('updates only what was sent', async () => {
    await request(app).put('/api/customers/c1').set(auth()).send({ phone: '555-0100' });

    expect(updateCustomer).toHaveBeenCalledWith('c1', expect.objectContaining({ phone: '555-0100' }));
  });

  it('404s for one that does not exist', async () => {
    updateCustomer.mockResolvedValue(null);

    expect(
      (await request(app).put('/api/customers/nope').set(auth()).send({ phone: '1' })).status
    ).toBe(404);
  });
});

describe('DELETE /api/customers/:id', () => {
  it('deletes one', async () => {
    expect((await request(app).delete('/api/customers/c1').set(auth())).status).toBe(200);
  });

  it('404s when there is nothing to delete', async () => {
    deleteCustomer.mockResolvedValue(false);

    expect((await request(app).delete('/api/customers/c1').set(auth())).status).toBe(404);
  });

  it('explains a foreign-key refusal instead of returning a 500', async () => {
    // "Cannot delete" with no reason leaves a shop nothing to act on; naming
    // the related records tells them what to clear first.
    const violation = Object.assign(new Error('foreign key constraint'), {
      code: '23503',
      constraint: 'orders_customer_id_fkey',
    });
    deleteCustomer.mockRejectedValue(violation);

    const response = await request(app).delete('/api/customers/c1').set(auth());

    expect(response.status).toBeLessThan(500);
    expect(response.body.error).toMatch(/orders/i);
  });

  it('needs customers.delete, not merely write', async () => {
    getUserByEmail.mockResolvedValue(actor({ customers: { read: true, write: true, delete: false } }));

    expect((await request(app).delete('/api/customers/c1').set(auth())).status).toBe(403);
    expect(deleteCustomer).not.toHaveBeenCalled();
  });
});

describe('POST /api/customers/:id/archive', () => {
  it('archives rather than deleting, so the history survives', async () => {
    const response = await request(app).post('/api/customers/c1/archive').set(auth());

    expect(response.status).toBe(200);
    // Records who archived it, which is the point of archiving over deleting.
    expect(archiveCustomer).toHaveBeenCalledWith('c1', 'u1', undefined);
  });

  it('records the reason when one is given', async () => {
    await request(app).post('/api/customers/c1/archive').set(auth()).send({ reason: 'moved away' });

    expect(archiveCustomer).toHaveBeenCalledWith('c1', 'u1', 'moved away');
  });

  it('404s for one that does not exist', async () => {
    getCustomerById.mockResolvedValue(null);

    expect((await request(app).post('/api/customers/nope/archive').set(auth())).status).toBe(404);
    expect(archiveCustomer).not.toHaveBeenCalled();
  });
});
