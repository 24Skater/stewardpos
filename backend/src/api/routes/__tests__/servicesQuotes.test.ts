import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Service catalog and quote routes.
 *
 * Quotes are money, and both sit behind the `services` permission — including
 * quotes, which is worth pinning down: a quote is priced service work, so the
 * people who may sell services are the people who may quote for it.
 */
const getUserByEmail = vi.fn();
const getAllServices = vi.fn();
const getServiceById = vi.fn();
const createService = vi.fn();
const updateService = vi.fn();
const deleteService = vi.fn();
const getAllQuotes = vi.fn();
const getQuoteById = vi.fn();
const getQuotesByCustomer = vi.fn();
const createQuote = vi.fn();
const updateQuote = vi.fn();
const updateQuoteStatus = vi.fn();
const deleteQuote = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllServices,
      getServiceById,
      createService,
      updateService,
      deleteService,
      getAllQuotes,
      getQuoteById,
      getQuotesByCustomer,
      createQuote,
      updateQuote,
      updateQuoteStatus,
      deleteQuote,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const SERVICE = { id: 's1', name: 'Repair', category: 'Bench', basePrice: 40, isActive: true };
const QUOTE = { id: 'q1', total: 80, status: 'draft', items: [] };

const QUOTE_BODY = {
  items: [{ description: 'Bench repair', quantity: 2, unitPrice: 40, lineTotal: 80 }],
  subtotal: 80,
  total: 80,
};

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
    roles: [{ id: 'r1', name: 'Bench', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ services: { read: true, write: true, delete: true } }));
  getAllServices.mockResolvedValue([SERVICE]);
  getServiceById.mockResolvedValue(SERVICE);
  createService.mockResolvedValue(SERVICE);
  updateService.mockResolvedValue(SERVICE);
  deleteService.mockResolvedValue(true);
  getAllQuotes.mockResolvedValue([QUOTE]);
  getQuoteById.mockResolvedValue(QUOTE);
  getQuotesByCustomer.mockResolvedValue([QUOTE]);
  createQuote.mockResolvedValue(QUOTE);
  updateQuote.mockResolvedValue(QUOTE);
  updateQuoteStatus.mockResolvedValue({ ...QUOTE, status: 'sent' });
  deleteQuote.mockResolvedValue(true);
  createAuditLog.mockResolvedValue({});
});

describe('services', () => {
  it('lists them', async () => {
    const response = await request(app).get('/api/services').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('returns one', async () => {
    expect((await request(app).get('/api/services/s1').set(auth())).body.data.id).toBe('s1');
  });

  it('404s for one that does not exist', async () => {
    getServiceById.mockResolvedValue(null);

    expect((await request(app).get('/api/services/nope').set(auth())).status).toBe(404);
  });

  it('creates one', async () => {
    const response = await request(app)
      .post('/api/services')
      .set(auth())
      .send({ name: 'Repair', category: 'Bench', basePrice: 40 });

    expect(response.status).toBe(201);
  });

  it('requires a category, which the column does not default', async () => {
    const response = await request(app).post('/api/services').set(auth()).send({ name: 'Repair' });

    expect(response.status).toBe(400);
    expect(createService).not.toHaveBeenCalled();
  });

  it('rejects a negative price', async () => {
    const response = await request(app)
      .post('/api/services')
      .set(auth())
      .send({ name: 'Repair', category: 'Bench', basePrice: -1 });

    expect(response.status).toBe(400);
  });

  it('rejects an unknown unit type', async () => {
    const response = await request(app)
      .post('/api/services')
      .set(auth())
      .send({ name: 'Repair', category: 'Bench', unitType: 'per_fortnight' });

    expect(response.status).toBe(400);
  });

  it('updates one', async () => {
    await request(app).put('/api/services/s1').set(auth()).send({ basePrice: 50 });

    expect(updateService).toHaveBeenCalledWith('s1', expect.objectContaining({ basePrice: 50 }));
  });

  it('needs services.delete to remove one', async () => {
    getUserByEmail.mockResolvedValue(actor({ services: { read: true, write: true, delete: false } }));

    expect((await request(app).delete('/api/services/s1').set(auth())).status).toBe(403);
  });
});

describe('quotes', () => {
  it('lists them', async () => {
    expect((await request(app).get('/api/quotes').set(auth())).body.data).toHaveLength(1);
  });

  it('finds those belonging to a customer', async () => {
    await request(app).get('/api/quotes/customer/c1').set(auth());

    expect(getQuotesByCustomer).toHaveBeenCalledWith('c1');
  });

  it('is not confused by the customer route preceding /:id', async () => {
    // `/customer/:customerId` is declared before `/:id`; reversed, a lookup for
    // a customer's quotes would be read as a quote whose id is "customer".
    await request(app).get('/api/quotes/customer/c1').set(auth());

    expect(getQuoteById).not.toHaveBeenCalled();
  });

  it('creates one', async () => {
    const response = await request(app).post('/api/quotes').set(auth()).send(QUOTE_BODY);

    expect(response.status).toBe(201);
  });

  it('refuses a quote with no lines', async () => {
    // An empty quote has nothing to price and nothing to accept.
    const response = await request(app)
      .post('/api/quotes')
      .set(auth())
      .send({ ...QUOTE_BODY, items: [] });

    expect(response.status).toBe(400);
    expect(createQuote).not.toHaveBeenCalled();
  });

  it('refuses a zero quantity line', async () => {
    const response = await request(app)
      .post('/api/quotes')
      .set(auth())
      .send({ ...QUOTE_BODY, items: [{ description: 'x', quantity: 0, unitPrice: 1, lineTotal: 0 }] });

    expect(response.status).toBe(400);
  });

  it('accepts a fractional quantity, for hourly work', async () => {
    const response = await request(app)
      .post('/api/quotes')
      .set(auth())
      .send({
        ...QUOTE_BODY,
        items: [{ description: 'Diagnosis', quantity: 0.5, unitPrice: 80, lineTotal: 40 }],
      });

    expect(response.status).toBe(201);
  });

  it('moves a quote through its statuses', async () => {
    const response = await request(app)
      .put('/api/quotes/q1/status')
      .set(auth())
      .send({ status: 'sent' });

    expect(response.status).toBe(200);
    expect(updateQuoteStatus).toHaveBeenCalledWith('q1', 'sent');
  });

  it('rejects a status that is not one of the known ones', async () => {
    const response = await request(app)
      .put('/api/quotes/q1/status')
      .set(auth())
      .send({ status: 'maybe' });

    expect(response.status).toBe(400);
    expect(updateQuoteStatus).not.toHaveBeenCalled();
  });

  it('404s on a status change to a quote that does not exist', async () => {
    updateQuoteStatus.mockResolvedValue(null);

    expect(
      (await request(app).put('/api/quotes/nope/status').set(auth()).send({ status: 'sent' })).status
    ).toBe(404);
  });

  it('needs the services permission, since a quote is priced service work', async () => {
    getUserByEmail.mockResolvedValue(actor({ services: { read: false } }));

    expect((await request(app).get('/api/quotes').set(auth())).status).toBe(403);
  });
});
