import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Reading receipts: the list, the search, and a single receipt.
 *
 * The list annotates each order with what has been returned against it, which
 * is what makes `netTotal` meaningful — a receipt showing the original total
 * after half of it was refunded is a misleading document to hand a customer.
 *
 * `receiptEmail.test.ts` covers resending; this covers everything else, which
 * was the larger untested half.
 */
const getUserByEmail = vi.fn();
const getAllOrders = vi.fn();
const getOrderById = vi.fn();
const getReturnsByOrder = vi.fn();

/**
 * The batched lookup the list endpoint uses, fed from the same fixture as the
 * per-order one the detail endpoint uses.
 *
 * Deliberately not an independent mock: the bug these tests exist for was the
 * two endpoints disagreeing about the same order, and giving each its own
 * fixture would let them drift in the test exactly as they drifted in the code.
 */
const getReturnSummariesByOrderIds = vi.fn(async (orderIds: string[]) => {
  const rows: Record<string, unknown>[] = [];
  for (const orderId of orderIds) {
    for (const ret of await getReturnsByOrder(orderId)) {
      rows.push({ ...ret, originalOrderId: orderId });
    }
  }
  return rows;
});
const getReceiptEmailHistory = vi.fn();
const searchOrders = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllOrders,
      getOrderById,
      getReturnsByOrder,
      getReturnSummariesByOrderIds,
      getReceiptEmailHistory,
      searchOrders,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const ORDER = { id: 'o1', total: 100, createdAt: Date.now(), items: [] };

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
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));
  getAllOrders.mockResolvedValue([ORDER]);
  getOrderById.mockResolvedValue(ORDER);
  getReturnsByOrder.mockResolvedValue([]);
  getReceiptEmailHistory.mockResolvedValue([]);
  searchOrders.mockResolvedValue([ORDER]);
});

describe('GET /api/receipts', () => {
  it('lists them', async () => {
    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('reports a clean order as fully payable', async () => {
    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.body.data[0]).toMatchObject({ hasReturns: false, netTotal: 100 });
  });

  it('subtracts what was returned, so netTotal is what the shop kept', async () => {
    // A receipt still showing $100 after $30 came back is a misleading document
    // to hand a customer — and a misleading number in a day's takings.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 30, status: 'completed' }]);

    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.body.data[0]).toMatchObject({
      hasReturns: true,
      returnCount: 1,
      totalReturned: 30,
      netTotal: 70,
    });
  });

  it('counts only completed returns against netTotal, as the detail view does', async () => {
    // The same rule the single-receipt endpoint already applies: a pending
    // return has paid nothing out yet, so deducting it understates the day's
    // takings. The list deducted every return regardless of status, so one
    // order reported two different net totals depending on which screen a
    // manager was looking at.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 40, status: 'pending' }]);

    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.body.data[0]).toMatchObject({ netTotal: 100, totalReturned: 0 });
  });

  it('does not deduct a rejected return', async () => {
    // A rejected return did not happen.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 40, status: 'rejected' }]);

    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.body.data[0]).toMatchObject({ netTotal: 100 });
  });

  it('still flags an order carrying a pending return', async () => {
    // Not deducting it must not mean hiding it — a manager needs to see that a
    // return is outstanding against the sale.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 40, status: 'pending' }]);

    const response = await request(app).get('/api/receipts').set(auth());

    expect(response.body.data[0]).toMatchObject({ hasReturns: true, returnCount: 1 });
  });

  it('agrees with the single-receipt endpoint on the same order', async () => {
    // The bug was a disagreement between two endpoints, so the regression test
    // is the agreement itself rather than either number in isolation.
    getReturnsByOrder.mockResolvedValue([
      { id: 'r1', total: 40, status: 'pending' },
      { id: 'r2', total: 25, status: 'completed' },
    ]);

    const list = await request(app).get('/api/receipts').set(auth());
    const detail = await request(app).get('/api/receipts/o1').set(auth());

    expect(list.body.data[0].netTotal).toBe(detail.body.data.netTotal);
    expect(list.body.data[0].netTotal).toBe(75);
  });

  it('pages, and says whether there is more', async () => {
    getAllOrders.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ ...ORDER, id: `o${i}` })));

    const response = await request(app).get('/api/receipts?limit=2&offset=0').set(auth());

    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({ total: 5, hasMore: true });
  });

  it('reports no more on the last page', async () => {
    getAllOrders.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ ...ORDER, id: `o${i}` })));

    const response = await request(app).get('/api/receipts?limit=2&offset=2').set(auth());

    expect(response.body.pagination.hasMore).toBe(false);
  });

  it('needs orders.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: false } }));

    expect((await request(app).get('/api/receipts').set(auth())).status).toBe(403);
  });
});

describe('GET /api/receipts/:id', () => {
  it('returns the receipt with its returns and email history', async () => {
    getReceiptEmailHistory.mockResolvedValue([{ recipientEmail: 'buyer@example.com', status: 'sent' }]);

    const response = await request(app).get('/api/receipts/o1').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.emailHistory).toHaveLength(1);
  });

  it('says a clean order can still be returned', async () => {
    expect((await request(app).get('/api/receipts/o1').set(auth())).body.data.canReturn).toBe(true);
  });

  it('says an already-returned order cannot be returned again', async () => {
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 100, status: 'completed' }]);

    expect((await request(app).get('/api/receipts/o1').set(auth())).body.data.canReturn).toBe(false);
  });

  it('still allows a return after a rejected one', async () => {
    // A rejected return did not happen, so it must not bar a legitimate one.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 100, status: 'rejected' }]);

    expect((await request(app).get('/api/receipts/o1').set(auth())).body.data.canReturn).toBe(true);
  });

  it('counts only completed returns against the net total', async () => {
    // A pending return has not paid anything out yet; deducting it would
    // understate the day's takings.
    getReturnsByOrder.mockResolvedValue([{ id: 'r1', total: 40, status: 'pending' }]);

    expect((await request(app).get('/api/receipts/o1').set(auth())).body.data.netTotal).toBe(100);
  });

  it('404s for an order that does not exist', async () => {
    getOrderById.mockResolvedValue(null);

    expect((await request(app).get('/api/receipts/nope').set(auth())).status).toBe(404);
  });
});

describe('GET /api/receipts/search', () => {
  it('searches rather than being read as an order id', async () => {
    // `/search` is declared before `/:id`; reversed, this would look up an
    // order whose id is literally "search".
    await request(app).get('/api/receipts/search?query=ada').set(auth());

    expect(searchOrders).toHaveBeenCalled();
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it('passes the filters through as numbers, not strings', async () => {
    await request(app)
      .get('/api/receipts/search?minAmount=10.5&maxAmount=99&limit=5&offset=10')
      .set(auth());

    expect(searchOrders).toHaveBeenCalledWith(
      expect.objectContaining({ minAmount: 10.5, maxAmount: 99, limit: 5, offset: 10 })
    );
  });

  it('defaults the page size rather than fetching everything', async () => {
    await request(app).get('/api/receipts/search').set(auth());

    expect(searchOrders.mock.calls[0][0].limit).toBe(50);
  });
});
