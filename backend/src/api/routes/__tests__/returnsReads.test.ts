import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Reading returns, and moving one through its statuses.
 *
 * `returnGuards.test.ts` covers restocking and refunding — the two operations
 * that move goods and money. This covers the rest of the surface: the lists,
 * the lookups, and the status transitions that gate those operations.
 *
 * Route ordering matters here more than usual: `/stats`, `/order/:orderId`, and
 * `/customer/:customerId` all sit in front of `/:id`, and any of them being
 * shadowed would turn a report into a lookup for a return whose id is "stats".
 */
const getUserByEmail = vi.fn();
const getAllReturns = vi.fn();
const getReturnById = vi.fn();
const getReturnsByOrder = vi.fn();
const getReturnsByCustomer = vi.fn();
const getReturnStats = vi.fn();
const updateReturnStatus = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllReturns,
      getReturnById,
      getReturnsByOrder,
      getReturnsByCustomer,
      getReturnStats,
      updateReturnStatus,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const RETURN = { id: 'r1', status: 'pending', total: 12.5, items: [] };

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
  getUserByEmail.mockResolvedValue(actor({ returns: { read: true, write: true, delete: true } }));
  getAllReturns.mockResolvedValue([RETURN]);
  getReturnById.mockResolvedValue(RETURN);
  getReturnsByOrder.mockResolvedValue([RETURN]);
  getReturnsByCustomer.mockResolvedValue([RETURN]);
  getReturnStats.mockResolvedValue({ totalReturns: 3, totalRefunded: 40 });
  updateReturnStatus.mockResolvedValue({ ...RETURN, status: 'approved' });
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/returns', () => {
  it('lists them', async () => {
    const response = await request(app).get('/api/returns').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('passes a status filter through', async () => {
    await request(app).get('/api/returns?status=approved').set(auth());

    expect(getAllReturns).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('passes a date range through as numbers', async () => {
    await request(app).get('/api/returns?startDate=1700000000000&endDate=1800000000000').set(auth());

    expect(getAllReturns).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: 1700000000000, endDate: 1800000000000 })
    );
  });

  it('needs returns.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ returns: { read: false } }));

    expect((await request(app).get('/api/returns').set(auth())).status).toBe(403);
  });
});

describe('GET /api/returns/stats', () => {
  it('reports the totals', async () => {
    const response = await request(app).get('/api/returns/stats').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ totalReturns: 3 });
  });

  it('is not read as a return id', async () => {
    await request(app).get('/api/returns/stats').set(auth());

    expect(getReturnStats).toHaveBeenCalled();
    expect(getReturnById).not.toHaveBeenCalled();
  });
});

describe('GET /api/returns/order/:orderId', () => {
  it('finds the returns taken against an order', async () => {
    await request(app).get('/api/returns/order/o1').set(auth());

    expect(getReturnsByOrder).toHaveBeenCalledWith('o1');
  });

  it('is not read as a return id', async () => {
    await request(app).get('/api/returns/order/o1').set(auth());

    expect(getReturnById).not.toHaveBeenCalled();
  });

  it('returns an empty list rather than a 404 for an order with none', async () => {
    // "No returns" is an answer; a 404 would read as "no such order".
    getReturnsByOrder.mockResolvedValue([]);

    const response = await request(app).get('/api/returns/order/o1').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

describe('GET /api/returns/customer/:customerId', () => {
  it('finds a customer’s returns', async () => {
    await request(app).get('/api/returns/customer/c1').set(auth());

    expect(getReturnsByCustomer).toHaveBeenCalledWith('c1');
  });
});

describe('GET /api/returns/:id', () => {
  it('returns one', async () => {
    expect((await request(app).get('/api/returns/r1').set(auth())).body.data.id).toBe('r1');
  });

  it('404s for one that does not exist', async () => {
    getReturnById.mockResolvedValue(null);

    expect((await request(app).get('/api/returns/nope').set(auth())).status).toBe(404);
  });
});

describe('PUT /api/returns/:id/status', () => {
  it('approves a return', async () => {
    const response = await request(app)
      .put('/api/returns/r1/status')
      .set(auth())
      .send({ status: 'approved' });

    expect(response.status).toBe(200);
    expect(updateReturnStatus).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'approved' })
    );
  });

  it('rejects a status outside the known set', async () => {
    const response = await request(app)
      .put('/api/returns/r1/status')
      .set(auth())
      .send({ status: 'maybe' });

    expect(response.status).toBe(400);
    expect(updateReturnStatus).not.toHaveBeenCalled();
  });

  it('404s for a return that does not exist', async () => {
    updateReturnStatus.mockResolvedValue(null);

    expect(
      (await request(app).put('/api/returns/nope/status').set(auth()).send({ status: 'approved' }))
        .status
    ).toBe(404);
  });

  it('needs returns.write, not merely read', async () => {
    getUserByEmail.mockResolvedValue(actor({ returns: { read: true, write: false } }));

    expect(
      (await request(app).put('/api/returns/r1/status').set(auth()).send({ status: 'approved' }))
        .status
    ).toBe(403);
    expect(updateReturnStatus).not.toHaveBeenCalled();
  });
});
