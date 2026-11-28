import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/** Test sends report the real outcome and are audited; the message log pages and refuses bad paging. */

const getUserByEmail = vi.fn();
const createAuditLog = vi.fn();
const getMessageLogs = vi.fn();
const sendEmail = vi.fn();
const sendSms = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, createAuditLog, getMessageLogs }) },
}));
vi.mock('../../../services/email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail,
}));
vi.mock('../../../services/sms', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendSms,
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

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ read: true, write: true }));
  createAuditLog.mockResolvedValue({});
  getMessageLogs.mockResolvedValue([]);
  sendEmail.mockResolvedValue({ status: 'sent' });
  sendSms.mockResolvedValue({ status: 'sent' });
});

describe('POST /api/admin/email/test', () => {
  it('sends, returns the outcome, and audits it', async () => {
    sendEmail.mockResolvedValue({ status: 'logged', detail: 'Email is not set up' });
    const res = await request(app).post('/api/admin/email/test').set(auth()).send({ to: 'owner@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'logged', detail: 'Email is not set up' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', template: 'test' }));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email_test', after: { to: 'owner@example.com', status: 'logged' } })
    );
  });

  it('refuses a bad address without sending', async () => {
    const res = await request(app).post('/api/admin/email/test').set(auth()).send({ to: 'nope' });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('passes a send failure to the error handler', async () => {
    sendEmail.mockRejectedValue(new Error('boom'));
    expect((await request(app).post('/api/admin/email/test').set(auth()).send({ to: 'a@example.com' })).status).toBe(500);
  });
});

describe('POST /api/admin/sms/test', () => {
  it('sends to the normalised number and audits the outcome', async () => {
    sendSms.mockResolvedValue({ status: 'failed', detail: 'This number has not opted in' });
    const res = await request(app).post('/api/admin/sms/test').set(auth()).send({ to: '(555) 123-4567' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
    expect(sendSms).toHaveBeenCalledWith('5551234567', expect.any(String), 'test');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sms_test', after: { to: '5551234567', status: 'failed' } })
    );
  });

  it('refuses a bad number without sending', async () => {
    const res = await request(app).post('/api/admin/sms/test').set(auth()).send({ to: '12' });
    expect(res.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('passes a send failure to the error handler', async () => {
    sendSms.mockRejectedValue(new Error('boom'));
    expect((await request(app).post('/api/admin/sms/test').set(auth()).send({ to: '5551234567' })).status).toBe(500);
  });

  it('needs settings write', async () => {
    getUserByEmail.mockResolvedValue(actor({ read: true, write: false }));
    expect((await request(app).post('/api/admin/sms/test').set(auth()).send({ to: '5551234567' })).status).toBe(403);
    expect((await request(app).post('/api/admin/email/test').set(auth()).send({ to: 'a@example.com' })).status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/messages', () => {
  it('pages with defaults, and passes given paging through', async () => {
    getMessageLogs.mockResolvedValue([{ id: 'm1' }]);
    const res = await request(app).get('/api/admin/messages').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'm1' }]);
    expect(getMessageLogs).toHaveBeenCalledWith(50, 0);

    await request(app).get('/api/admin/messages?limit=10&offset=20').set(auth());
    expect(getMessageLogs).toHaveBeenLastCalledWith(10, 20);
  });

  it('refuses paging out of range', async () => {
    expect((await request(app).get('/api/admin/messages?limit=500').set(auth())).status).toBe(400);
    expect((await request(app).get('/api/admin/messages?offset=-1').set(auth())).status).toBe(400);
    expect(getMessageLogs).not.toHaveBeenCalled();
  });

  it('passes a read failure to the error handler', async () => {
    getMessageLogs.mockRejectedValue(new Error('db down'));
    expect((await request(app).get('/api/admin/messages').set(auth())).status).toBe(500);
  });
});
