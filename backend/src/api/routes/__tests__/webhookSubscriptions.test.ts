import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/** Webhook subscription admin: secrets appear once, rotation keeps the old one, redelivery requeues. */
const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const createWebhookSubscription = vi.fn();
const rotateWebhookSecret = vi.fn();
const redeliverWebhook = vi.fn();
const listWebhookDeliveries = vi.fn();
const listWebhookSubscriptions = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getSettings,
      createWebhookSubscription,
      rotateWebhookSecret,
      redeliverWebhook,
      listWebhookDeliveries,
      listWebhookSubscriptions,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const SUB = { id: 's1', url: 'https://example.test/h', events: ['order.created'], active: true, createdAt: 0, rotating: false };

const auth = () => ({
  Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'a@example.com', roleIds: ['r1'] }, config.jwt.secret, { expiresIn: '1h' })}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Manager', systemRole: 'admin', permissions: { settings: { read: true, write: true } } }],
  });
  getSettings.mockResolvedValue({ providers: {} });
  createWebhookSubscription.mockResolvedValue(SUB);
  rotateWebhookSecret.mockResolvedValue({ ...SUB, rotating: true });
  redeliverWebhook.mockResolvedValue(true);
  listWebhookDeliveries.mockResolvedValue([]);
  createAuditLog.mockResolvedValue({});
});

describe('webhook subscriptions', () => {
  it('returns the secret on create', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks')
      .set(auth())
      .send({ url: 'https://203.0.113.9/h', events: ['order.created'] });
    expect(res.status).toBe(201);
    expect(res.body.data.secret).toMatch(/^whsec_/);
  });

  it('refuses a private URL', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks')
      .set(auth())
      .send({ url: 'https://169.254.169.254/x', events: ['order.created'] });
    expect(res.status).toBe(400);
    expect(createWebhookSubscription).not.toHaveBeenCalled();
  });

  it('rotates a secret, keeping the old one valid for 24 hours', async () => {
    const before = Date.now();
    const res = await request(app).post('/api/admin/webhooks/s1/rotate-secret').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toMatch(/^whsec_/);
    const expiresAt = rotateWebhookSecret.mock.calls[0][2] as number;
    expect(expiresAt - before).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('404s when rotating an unknown subscription', async () => {
    rotateWebhookSecret.mockResolvedValue(null);
    expect((await request(app).post('/api/admin/webhooks/nope/rotate-secret').set(auth())).status).toBe(404);
  });

  it('requeues a delivery', async () => {
    const res = await request(app).post('/api/admin/webhooks/deliveries/d1/redeliver').set(auth());
    expect(res.status).toBe(200);
    expect(redeliverWebhook).toHaveBeenCalledWith('d1');
  });

  it('404s when redelivering an unknown delivery', async () => {
    redeliverWebhook.mockResolvedValue(false);
    expect((await request(app).post('/api/admin/webhooks/deliveries/x/redeliver').set(auth())).status).toBe(404);
  });

  it('filters deliveries by status', async () => {
    await request(app).get('/api/admin/webhooks/deliveries?status=dead').set(auth());
    expect(listWebhookDeliveries).toHaveBeenCalledWith('dead', 200);
  });
});
