import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getSettings, updateSettings }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const CREDENTIALS = { stripeSecretKey: 'sk_live_do_not_leak', squareAccessToken: 'sq_live_secret' };

function adminToken(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

/**
 * `NO_CREDENTIALS` rather than `undefined`: passing `undefined` to a parameter
 * with a default re-triggers that default, which would quietly reinstate the
 * credentials the "nothing stored" case is meant to omit.
 */
const NO_CREDENTIALS = Symbol('none');

function storedSettings(terminalCredentials: unknown = CREDENTIALS) {
  return {
    taxRateDefault: 0.08,
    storeName: 'Test Store',
    storeEmail: 'store@example.com',
    storePhone: '555',
    config: {
      demoMode: false,
      paymentMethods: { card: { enabled: true, provider: 'stripe' } },
      ...(terminalCredentials === NO_CREDENTIALS ? {} : { terminalCredentials }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getSettings.mockResolvedValue(storedSettings());
  updateSettings.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...storedSettings(),
    ...patch,
  }));
});

describe('GET /api/admin/settings', () => {
  it('never returns terminal credentials', async () => {
    const response = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.config).not.toHaveProperty('terminalCredentials');
    expect(JSON.stringify(response.body)).not.toContain('sk_live_do_not_leak');
    expect(JSON.stringify(response.body)).not.toContain('sq_live_secret');
  });

  it('still reports whether a provider is configured', async () => {
    const configured = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(configured.body.data.config.terminalCredentialsConfigured).toBe(true);

    getSettings.mockResolvedValue(storedSettings({}));
    const blank = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(blank.body.data.config.terminalCredentialsConfigured).toBe(false);
  });

  it('leaves the non-secret settings intact', async () => {
    const response = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.body.data.storeName).toBe('Test Store');
    expect(response.body.data.config.paymentMethods.card.provider).toBe('stripe');
  });
});

describe('PUT /api/admin/settings', () => {
  it('keeps stored credentials when the payload omits them', async () => {
    // The form cannot echo back secrets it was never sent, so a save of an
    // unrelated field must not wipe them and take card payments offline.
    await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ storePhone: '555-0199', config: { demoMode: false } });

    const saved = updateSettings.mock.calls[0][0];
    expect(saved.config.terminalCredentials).toEqual(CREDENTIALS);
  });

  it('keeps them when the payload sends an empty credential object', async () => {
    await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ config: { demoMode: false, terminalCredentials: {} } });

    expect(updateSettings.mock.calls[0][0].config.terminalCredentials).toEqual(CREDENTIALS);
  });

  it('overwrites when a new key is actually supplied', async () => {
    await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ config: { terminalCredentials: { stripeSecretKey: 'sk_live_rotated' } } });

    expect(updateSettings.mock.calls[0][0].config.terminalCredentials).toEqual({
      stripeSecretKey: 'sk_live_rotated',
    });
  });

  it('does not echo the credentials back in its response', async () => {
    const response = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ storePhone: '555-0199', config: { demoMode: false } });

    expect(JSON.stringify(response.body)).not.toContain('sk_live_do_not_leak');
  });

  it('stores nothing when there are no credentials on either side', async () => {
    getSettings.mockResolvedValue(storedSettings(NO_CREDENTIALS));

    await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ config: { demoMode: true, terminalCredentials: {} } });

    expect(updateSettings.mock.calls[0][0].config).not.toHaveProperty('terminalCredentials');
  });
});
