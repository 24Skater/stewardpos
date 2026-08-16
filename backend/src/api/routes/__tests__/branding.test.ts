import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Store branding through the settings endpoint.
 *
 * These columns have existed since the branding migration and the schema has
 * always accepted them, but nothing on either side used them — no screen could
 * set a brand colour and no screen read one. Now that both halves exist, this
 * pins the contract between them: the fields survive a round trip, and a colour
 * the theme cannot use is refused at the door rather than written into the CSS
 * of every till in the shop.
 */
const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getSettings, updateSettings, createAuditLog }),
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

const BRANDING = {
  storeName: 'Corner Store',
  brandColor: '#1B2A41',
  logoUrl: 'https://cdn.example.test/logo.png',
  iconUrl: '/uploads/icon.png',
  receiptHeaderText: 'Thank you for supporting our ministry',
  receiptFooterText: 'Returns within 30 days with this receipt',
  receiptLogoUrl: '/uploads/receipt-logo.png',
  receiptShowLogo: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [
      {
        id: 'r1',
        name: 'Owner',
        systemRole: 'standard',
        permissions: { settings: { read: true, write: true } },
      },
    ],
  });
  getSettings.mockResolvedValue({ taxRateDefault: 0.08, storeName: 'Old Name' });
  updateSettings.mockImplementation(async (patch: Record<string, unknown>) => ({
    taxRateDefault: 0.08,
    ...patch,
  }));
  createAuditLog.mockResolvedValue({ id: 'a1' });
});

describe('PUT /api/admin/settings — branding', () => {
  it('stores every branding field it is given', async () => {
    const response = await request(app).put('/api/admin/settings').set(auth()).send(BRANDING);

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining(BRANDING));
  });

  it('returns the saved branding, so the app can apply it without a reload', async () => {
    const response = await request(app).put('/api/admin/settings').set(auth()).send(BRANDING);

    expect(response.body.data).toMatchObject({
      brandColor: '#1B2A41',
      iconUrl: '/uploads/icon.png',
      receiptFooterText: 'Returns within 30 days with this receipt',
    });
  });

  it('refuses a colour the theme cannot use', async () => {
    // The value is written straight into a CSS custom property on every screen.
    // `red; background: url(...)` is the reason this is a strict hex and not a
    // free string.
    for (const brandColor of ['red', '#FFF', 'rgb(1,2,3)', '#GGGGGG', 'blue; content: "x"']) {
      const response = await request(app)
        .put('/api/admin/settings')
        .set(auth())
        .send({ brandColor });

      expect(response.status).toBe(400);
    }

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('accepts a cleared colour, which means "use the default"', async () => {
    const response = await request(app)
      .put('/api/admin/settings')
      .set(auth())
      .send({ brandColor: '' });

    expect(response.status).toBe(200);
  });

  it('is gated on settings:write, not merely on being signed in', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [
        { id: 'r1', name: 'Till', systemRole: 'standard', permissions: { settings: { read: true } } },
      ],
    });

    const response = await request(app).put('/api/admin/settings').set(auth()).send(BRANDING);

    expect(response.status).toBe(403);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('reads the branding back', async () => {
    getSettings.mockResolvedValue({ taxRateDefault: 0.08, ...BRANDING });

    const response = await request(app).get('/api/admin/settings').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ brandColor: '#1B2A41', logoUrl: BRANDING.logoUrl });
  });
});
