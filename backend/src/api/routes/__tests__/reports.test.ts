import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * The reporting endpoints: who may read them, what a bad range does, and that
 * the range reaches the adapter intact.
 *
 * The adapter is mocked here on purpose — the arithmetic is covered in
 * `services/__tests__/reports.test.ts` and the SQL against a real database in
 * the integration suite. What only a route test can show is that these are
 * behind `reports:read` rather than merely behind a login: a cashier can take
 * orders and should not thereby be able to read the shop's takings.
 */
const getUserByEmail = vi.fn();
const getSalesTotals = vi.fn();
const getReturnsTotals = vi.fn();
const getReturnsByReason = vi.fn();
const getSalesByDay = vi.fn();
const getTopProducts = vi.fn();
const getPaymentMix = vi.fn();
const getSalesByRegister = vi.fn();
const getSalesByCashier = vi.fn();
const getSalesByLocation = vi.fn();
const getDrawerVarianceByRegister = vi.fn();
const getNoSaleCounts = vi.fn();
const getRegisterHourly = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getSalesTotals,
      getReturnsTotals,
      getReturnsByReason,
      getSalesByDay,
      getTopProducts,
      getPaymentMix,
      getSalesByRegister,
      getSalesByCashier,
      getSalesByLocation,
      getDrawerVarianceByRegister,
      getNoSaleCounts,
      getRegisterHourly,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'manager@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'manager@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Desk', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const ENDPOINTS = [
  '/api/reports/sales-summary',
  '/api/reports/sales-by-day',
  '/api/reports/top-products',
  '/api/reports/payment-mix',
  '/api/reports/returns-summary',
  '/api/reports/sales-by-register',
  '/api/reports/sales-by-cashier',
  '/api/reports/sales-by-location',
  '/api/reports/drawer-variance-by-register',
  '/api/reports/no-sale-counts',
];

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ reports: { read: true } }));
  getSalesTotals.mockResolvedValue({
    orderCount: 2,
    gross: 100,
    discounts: 10,
    tax: 7.2,
    net: 97.2,
  });
  getReturnsTotals.mockResolvedValue({
    returnCount: 1,
    refunded: 20,
    pendingCount: 0,
    pendingAmount: 0,
  });
  getReturnsByReason.mockResolvedValue([{ reasonCode: 'defective', returnCount: 1, refunded: 20 }]);
  getSalesByDay.mockResolvedValue([{ date: '2026-08-01', orderCount: 2, gross: 100, net: 97.2 }]);
  getTopProducts.mockResolvedValue([
    { productId: 'p1', name: 'Loose Leaf Tea', quantity: 4, revenue: 20 },
  ]);
  getPaymentMix.mockResolvedValue([{ method: 'cash', count: 2, amount: 97.2 }]);
  getSalesByRegister.mockResolvedValue([
    {
      registerId: 'r1',
      displayCode: 'MAIN-01',
      name: 'Register 1',
      locationId: 'l1',
      locationName: 'Main',
      type: 'fixed',
      hasCashDrawer: true,
      status: 'active',
      orderCount: 2,
      gross: 100,
      discounts: 10,
      tax: 7.2,
      net: 97.2,
    },
  ]);
  getSalesByCashier.mockResolvedValue([
    { cashierUserId: 'u1', cashierName: 'Alex', orderCount: 2, gross: 100, net: 97.2 },
  ]);
  getSalesByLocation.mockResolvedValue([
    { locationId: 'l1', locationName: 'Main', registerCount: 1, orderCount: 2, net: 97.2 },
  ]);
  getDrawerVarianceByRegister.mockResolvedValue([
    {
      registerId: 'r1',
      displayCode: 'MAIN-01',
      name: 'Register 1',
      sessionCount: 1,
      totalVariance: -5,
      worstVariance: -5,
      shortCount: 1,
    },
  ]);
  getNoSaleCounts.mockResolvedValue([
    { registerId: 'r1', displayCode: 'MAIN-01', name: 'Register 1', noSaleCount: 3 },
  ]);
  getRegisterHourly.mockResolvedValue([{ hour: 9, orderCount: 2, net: 20 }]);
});

describe('access control', () => {
  it.each(ENDPOINTS)('refuses %s without a token', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  it.each(ENDPOINTS)('refuses %s to a role without reports:read', async (path) => {
    // A cashier: everything needed to take a sale, nothing that reveals what the
    // shop earns.
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));

    expect((await request(app).get(path).set(auth())).status).toBe(403);
  });

  it.each(ENDPOINTS)('allows %s to a role with reports:read', async (path) => {
    expect((await request(app).get(path).set(auth())).status).toBe(200);
  });
});

describe('GET /api/reports/sales-summary', () => {
  it('returns the composed summary in the envelope', async () => {
    const response = await request(app)
      .get('/api/reports/sales-summary?from=2026-08-01&to=2026-08-31')
      .set(auth());

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      orderCount: 2,
      gross: 100,
      discounts: 10,
      tax: 7.2,
      net: 97.2,
      refunds: 20,
      netAfterRefunds: 77.2,
      avgTicket: 48.6,
    });
  });

  it('passes the parsed range to the adapter, with the end of the last day included', async () => {
    await request(app).get('/api/reports/sales-summary?from=2026-08-01&to=2026-08-01').set(auth());

    expect(getSalesTotals).toHaveBeenCalledWith(
      {
        from: Date.parse('2026-08-01T00:00:00.000Z'),
        to: Date.parse('2026-08-01T23:59:59.999Z'),
      },
      { registerIds: undefined, locationIds: undefined, cashierUserIds: undefined }
    );
  });

  it('rejects a backwards range as a 400, not a 500', async () => {
    const response = await request(app)
      .get('/api/reports/sales-summary?from=2026-08-31&to=2026-08-01')
      .set(auth());

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('ignores an unknown query parameter rather than refusing the report', async () => {
    // A stale bookmark carrying `?period=today` should still render.
    const response = await request(app).get('/api/reports/sales-summary?period=today').set(auth());

    expect(response.status).toBe(200);
  });
});

describe('GET /api/reports/top-products', () => {
  it('defaults to ten and clamps a larger request', async () => {
    await request(app).get('/api/reports/top-products').set(auth());
    expect(getTopProducts).toHaveBeenLastCalledWith(expect.anything(), 10, expect.anything());

    await request(app).get('/api/reports/top-products?limit=1000').set(auth());
    expect(getTopProducts).toHaveBeenLastCalledWith(expect.anything(), 100, expect.anything());
  });

  it('rejects a nonsense limit', async () => {
    const response = await request(app).get('/api/reports/top-products?limit=-1').set(auth());

    expect(response.status).toBe(400);
  });
});

describe('the other series', () => {
  it('returns the daily series as the adapter grouped it', async () => {
    const response = await request(app).get('/api/reports/sales-by-day').set(auth());

    expect(response.body.data).toEqual([
      { date: '2026-08-01', orderCount: 2, gross: 100, net: 97.2 },
    ]);
  });

  it('returns the tender split', async () => {
    const response = await request(app).get('/api/reports/payment-mix').set(auth());

    expect(response.body.data).toEqual([{ method: 'cash', count: 2, amount: 97.2 }]);
  });

  it('returns refunds with their reasons', async () => {
    const response = await request(app).get('/api/reports/returns-summary').set(auth());

    expect(response.body.data).toMatchObject({
      refunded: 20,
      byReason: [{ reasonCode: 'defective', returnCount: 1, refunded: 20 }],
    });
  });
});

describe('GET /api/reports/sales-by-register', () => {
  it('bundles the per-register list with the web-vs-drawer split', async () => {
    const response = await request(app).get('/api/reports/sales-by-register').set(auth());

    expect(response.body.data.registers).toEqual([
      expect.objectContaining({ registerId: 'r1', orderCount: 2, net: 97.2 }),
    ]);
    // The split is composed in the service from the same rows, not a second
    // adapter call this route test mocks directly — asserting its shape here
    // is enough to prove the route wires it through.
    expect(response.body.data.capabilitySplit).toEqual({
      drawerCapable: { registerCount: 1, orderCount: 2, net: 97.2 },
      nonDrawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
    });
  });
});

describe('the register/location/cashier filter', () => {
  it('accepts repeated query parameters', async () => {
    await request(app)
      .get('/api/reports/sales-by-register?registerIds=r1&registerIds=r2')
      .set(auth());

    expect(getSalesByRegister).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ registerIds: ['r1', 'r2'] })
    );
  });

  it('accepts a comma-separated value', async () => {
    await request(app).get('/api/reports/sales-by-cashier?cashierUserIds=u1,u2').set(auth());

    expect(getSalesByCashier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cashierUserIds: ['u1', 'u2'] })
    );
  });

  it('narrows sales-by-location to locationIds', async () => {
    await request(app).get('/api/reports/sales-by-location?locationIds=l1').set(auth());

    expect(getSalesByLocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: ['l1'] })
    );
  });

  it('reaches the existing sales-summary endpoint too, not just the new ones', async () => {
    await request(app).get('/api/reports/sales-summary?registerIds=r1').set(auth());

    expect(getSalesTotals).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ registerIds: ['r1'] })
    );
  });
});

describe('GET /api/reports/sales-by-cashier', () => {
  it('returns sales attributed to the cashier', async () => {
    const response = await request(app).get('/api/reports/sales-by-cashier').set(auth());

    expect(response.body.data).toEqual([
      {
        cashierUserId: 'u1',
        cashierName: 'Alex',
        orderCount: 2,
        gross: 100,
        net: 97.2,
        avgTicket: 48.6,
      },
    ]);
  });
});

describe('GET /api/reports/sales-by-location', () => {
  it('returns sales rolled up per site', async () => {
    const response = await request(app).get('/api/reports/sales-by-location').set(auth());

    expect(response.body.data).toEqual([
      { locationId: 'l1', locationName: 'Main', registerCount: 1, orderCount: 2, net: 97.2 },
    ]);
  });
});

describe('GET /api/reports/drawer-variance-by-register', () => {
  it('returns session counts and variance per register', async () => {
    const response = await request(app)
      .get('/api/reports/drawer-variance-by-register')
      .set(auth());

    expect(response.body.data).toEqual([
      {
        registerId: 'r1',
        displayCode: 'MAIN-01',
        name: 'Register 1',
        sessionCount: 1,
        totalVariance: -5,
        worstVariance: -5,
        shortCount: 1,
      },
    ]);
  });
});

describe('GET /api/reports/no-sale-counts', () => {
  it('returns the no-sale count per register', async () => {
    const response = await request(app).get('/api/reports/no-sale-counts').set(auth());

    expect(response.body.data).toEqual([
      { registerId: 'r1', displayCode: 'MAIN-01', name: 'Register 1', noSaleCount: 3 },
    ]);
  });
});

describe('GET /api/reports/register-hourly', () => {
  it('refuses without a token', async () => {
    expect((await request(app).get('/api/reports/register-hourly?registerId=r1')).status).toBe(
      401
    );
  });

  it('refuses a role without reports:read', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));

    expect(
      (await request(app).get('/api/reports/register-hourly?registerId=r1').set(auth())).status
    ).toBe(403);
  });

  it('requires registerId', async () => {
    const response = await request(app).get('/api/reports/register-hourly').set(auth());

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('returns the hourly series for the given register', async () => {
    const response = await request(app)
      .get('/api/reports/register-hourly?registerId=r1')
      .set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ hour: 9, orderCount: 2, net: 20 }]);
    expect(getRegisterHourly).toHaveBeenCalledWith(expect.anything(), 'r1');
  });
});
