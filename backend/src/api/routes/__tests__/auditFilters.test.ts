import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Filtering and paging the audit trail.
 *
 * The endpoint took `limit`, `offset` and `userId`, applied no validation to any
 * of them, and returned no total. The screen above it therefore fetched the
 * newest hundred rows and filtered them in the browser — a search box that
 * looked like it searched the audit log and searched one page of it, which is
 * the sort of thing someone only discovers while trying to find out who deleted
 * something.
 */
const getUserByEmail = vi.fn();
const getAuditLogs = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getAuditLogs }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const ENTRY = {
  id: 'a1',
  timestamp: Date.parse('2026-08-16T10:00:00.000Z'),
  userId: 'u9',
  userName: 'Ada',
  action: 'update',
  entity: 'product',
  entityId: 'p1',
  before: { price: 5 },
  after: { price: 6 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Desk', systemRole: 'standard', permissions: { settings: { read: true } } }],
  });
  getAuditLogs.mockResolvedValue({ logs: [ENTRY], total: 137 });
});

describe('GET /api/admin/audit', () => {
  it('reports the total so a caller can page through it', async () => {
    const response = await request(app).get('/api/admin/audit').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ total: 137, limit: 50, offset: 0, page: 1 });
  });

  it('knows there is more to come', async () => {
    // Without a total this is unanswerable: a full page and the last page look
    // identical.
    const response = await request(app).get('/api/admin/audit').set(auth());

    expect(response.body.meta.hasMore).toBe(true);
  });

  it('knows when it has reached the end', async () => {
    getAuditLogs.mockResolvedValue({ logs: [ENTRY], total: 1 });

    const response = await request(app).get('/api/admin/audit').set(auth());

    expect(response.body.meta.hasMore).toBe(false);
  });

  it('carries the before and after through, which is the point of the log', async () => {
    const response = await request(app).get('/api/admin/audit').set(auth());

    expect(response.body.data[0]).toMatchObject({
      before: { price: 5 },
      after: { price: 6 },
    });
  });

  it('passes every filter down to the query rather than filtering after the fact', async () => {
    await request(app)
      .get('/api/admin/audit?userId=u9&entity=product&action=update&from=1000&to=2000&limit=25&offset=50')
      .set(auth());

    expect(getAuditLogs).toHaveBeenCalledWith({
      userId: 'u9',
      entity: 'product',
      action: 'update',
      from: 1000,
      to: 2000,
      limit: 25,
      offset: 50,
    });
  });

  it('reports the page a given offset lands on', async () => {
    const response = await request(app).get('/api/admin/audit?limit=25&offset=50').set(auth());

    expect(response.body.meta.page).toBe(3);
  });

  it('defaults to a page of fifty', async () => {
    await request(app).get('/api/admin/audit').set(auth());

    expect(getAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
  });

  it('refuses a limit beyond the cap rather than serving the whole table', async () => {
    const response = await request(app).get('/api/admin/audit?limit=5000').set(auth());

    expect(response.status).toBe(400);
    expect(getAuditLogs).not.toHaveBeenCalled();
  });

  it('refuses a limit that is not a number', async () => {
    // `parseInt('abc')` is NaN, which used to reach the adapter and become
    // `LIMIT NaN`.
    expect((await request(app).get('/api/admin/audit?limit=abc').set(auth())).status).toBe(400);
  });

  it('refuses a negative offset', async () => {
    expect((await request(app).get('/api/admin/audit?offset=-5').set(auth())).status).toBe(400);
  });

  it('refuses a backwards date range', async () => {
    const response = await request(app).get('/api/admin/audit?from=2000&to=1000').set(auth());

    expect(response.status).toBe(400);
  });

  it('is still gated on settings:read', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Till', systemRole: 'standard', permissions: { orders: { read: true } } }],
    });

    expect((await request(app).get('/api/admin/audit').set(auth())).status).toBe(403);
  });
});
