import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/** Template routes: list falls back to defaults, saves are audited, preview renders without sending. */

const getUserByEmail = vi.fn();
const createAuditLog = vi.fn();
const getMessageTemplates = vi.fn();
const upsertMessageTemplate = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, createAuditLog, getMessageTemplates, upsertMessageTemplate }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const auth = () => ({
  Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'a@example.com', roleIds: ['r1'] }, config.jwt.secret, { expiresIn: '1h' })}`,
});

function actor(settings: { read: boolean; write: boolean }) {
  return {
    id: 'u1',
    email: 'a@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Desk', systemRole: 'standard', permissions: { settings } }],
  };
}

const DRAFT = { subject: 'Receipt {{orderId}}', body: 'Thanks <b>{{orderId}}</b>', enabled: false };

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ read: true, write: true }));
  createAuditLog.mockResolvedValue({});
  getMessageTemplates.mockResolvedValue([]);
  upsertMessageTemplate.mockResolvedValue(undefined);
});

describe('GET /api/admin/templates', () => {
  it('lists every key on both channels, with its variables', async () => {
    const res = await request(app).get('/api/admin/templates').set(auth());

    expect(res.status).toBe(200);
    const receipt = res.body.data.filter((t: { key: string }) => t.key === 'receipt');
    expect(receipt.map((t: { channel: string }) => t.channel).sort()).toEqual(['email', 'sms']);
    expect(receipt[0].vars).toEqual(expect.arrayContaining(['orderId']));
  });

  it('passes a read failure to the error handler', async () => {
    getMessageTemplates.mockRejectedValue(new Error('db down'));
    expect((await request(app).get('/api/admin/templates').set(auth())).status).toBe(500);
  });
});

describe('PUT /api/admin/templates/:key/:channel', () => {
  it('saves and audits the template', async () => {
    const res = await request(app).put('/api/admin/templates/receipt/email').set(auth()).send(DRAFT);

    expect(res.status).toBe(200);
    expect(upsertMessageTemplate).toHaveBeenCalledWith({ key: 'receipt', channel: 'email', ...DRAFT });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'template:receipt:email' }));
  });

  it('refuses an unknown key or channel, or an empty body', async () => {
    const put = (path: string, body: object) => request(app).put(path).set(auth()).send(body);
    expect((await put('/api/admin/templates/nope/email', DRAFT)).status).toBe(400);
    expect((await put('/api/admin/templates/receipt/fax', DRAFT)).status).toBe(400);
    expect((await put('/api/admin/templates/receipt/email', { ...DRAFT, body: '' })).status).toBe(400);
    expect(upsertMessageTemplate).not.toHaveBeenCalled();
  });

  it('needs settings write', async () => {
    getUserByEmail.mockResolvedValue(actor({ read: true, write: false }));
    expect((await request(app).put('/api/admin/templates/receipt/email').set(auth()).send(DRAFT)).status).toBe(403);
    expect(upsertMessageTemplate).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/templates/:key/:channel/preview', () => {
  it('renders sample data and saves nothing', async () => {
    const res = await request(app).post('/api/admin/templates/receipt/email/preview').set(auth()).send(DRAFT);

    expect(res.status).toBe(200);
    expect(res.body.data.subject).not.toContain('{{');
    expect(res.body.data.text).not.toContain('{{');
    expect(upsertMessageTemplate).not.toHaveBeenCalled();
  });

  it('refuses an unknown key', async () => {
    expect((await request(app).post('/api/admin/templates/nope/sms/preview').set(auth()).send(DRAFT)).status).toBe(400);
  });
});
