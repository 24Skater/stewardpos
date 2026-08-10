import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const seed = vi.fn();
const close = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail, pool: { query: vi.fn() } }) },
}));

vi.mock('../../../services/seeder', () => ({
  Seeder: class {
    seed = seed;
    close = close;
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const originalEnv = config.nodeEnv;

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
});

afterEach(() => {
  (config as { nodeEnv: string }).nodeEnv = originalEnv;
});

describe('POST /api/admin/reset-database', () => {
  it('refuses outright in production', async () => {
    // It truncates the sales ledger, deletes every staff account, and reseeds an
    // admin whose password is published in this repository. One click on a live
    // install would be unrecoverable.
    (config as { nodeEnv: string }).nodeEnv = 'production';

    const response = await request(app)
      .post('/api/admin/reset-database')
      .set('Authorization', `Bearer ${token()}`)
      .send({ confirm: 'RESET' });

    expect(response.status).toBe(403);
    expect(seed).not.toHaveBeenCalled();
  });

  it('requires an explicit confirmation outside production', async () => {
    (config as { nodeEnv: string }).nodeEnv = 'development';

    const response = await request(app)
      .post('/api/admin/reset-database')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(seed).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that is merely truthy', async () => {
    (config as { nodeEnv: string }).nodeEnv = 'development';

    const response = await request(app)
      .post('/api/admin/reset-database')
      .set('Authorization', `Bearer ${token()}`)
      .send({ confirm: true });

    expect(response.status).toBe(400);
    expect(seed).not.toHaveBeenCalled();
  });

  it('proceeds in development with the confirmation', async () => {
    (config as { nodeEnv: string }).nodeEnv = 'development';

    const response = await request(app)
      .post('/api/admin/reset-database')
      .set('Authorization', `Bearer ${token()}`)
      .send({ confirm: 'RESET' });

    expect(response.status).toBe(200);
    expect(seed).toHaveBeenCalled();
  });

  it('still requires an admin', async () => {
    (config as { nodeEnv: string }).nodeEnv = 'development';
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Supervisor', systemRole: 'supervisor', permissions: {} }],
    });

    const response = await request(app)
      .post('/api/admin/reset-database')
      .set('Authorization', `Bearer ${token()}`)
      .send({ confirm: 'RESET' });

    expect(response.status).toBe(403);
    expect(seed).not.toHaveBeenCalled();
  });
});
