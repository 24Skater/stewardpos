import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getLocations = vi.fn();
const getLocationById = vi.fn();
const createLocation = vi.fn();
const updateLocation = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getLocations,
      getLocationById,
      createLocation,
      updateLocation,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../../middleware/auth');
const { default: app } = await import('../../../app');

const OTHER_ORG = '11111111-1111-1111-1111-111111111111';

const LOCATION = {
  id: 'loc-1',
  orgId: DEFAULT_ORG_ID,
  name: 'Main Location',
  slug: 'main-location',
  status: 'active',
  registerCount: 2,
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
    roles: [{ id: 'r1', name: 'Manager', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const FULL_PERMS = { registers: { read: true, write: true, delete: true } };

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor(FULL_PERMS));
  getLocations.mockResolvedValue([LOCATION]);
  getLocationById.mockResolvedValue(LOCATION);
  createLocation.mockResolvedValue(LOCATION);
  updateLocation.mockResolvedValue(LOCATION);
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/locations', () => {
  it('lists locations for the org', async () => {
    const response = await request(app).get('/api/locations').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([LOCATION]);
    expect(getLocations).toHaveBeenCalledWith(DEFAULT_ORG_ID);
  });

  it('needs registers.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: false } }));

    expect((await request(app).get('/api/locations').set(auth())).status).toBe(403);
  });

  it('401s without a token', async () => {
    expect((await request(app).get('/api/locations')).status).toBe(401);
  });
});

describe('GET /api/locations/:id', () => {
  it('gets one', async () => {
    const response = await request(app).get('/api/locations/loc-1').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(LOCATION);
  });

  it('404s when it does not exist', async () => {
    getLocationById.mockResolvedValue(null);

    expect((await request(app).get('/api/locations/nope').set(auth())).status).toBe(404);
  });

  it('404s rather than leaks a location belonging to a different org', async () => {
    getLocationById.mockResolvedValue({ ...LOCATION, orgId: OTHER_ORG });

    expect((await request(app).get('/api/locations/loc-1').set(auth())).status).toBe(404);
  });

  it('needs registers.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: false } }));

    expect((await request(app).get('/api/locations/loc-1').set(auth())).status).toBe(403);
  });
});

describe('POST /api/locations', () => {
  it('creates one, deriving the slug from the name', async () => {
    const response = await request(app)
      .post('/api/locations')
      .set(auth())
      .send({ name: '1st Floor / Café' });

    expect(response.status).toBe(201);
    expect(createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: DEFAULT_ORG_ID, name: '1st Floor / Café', slug: '1st-floor-cafe' })
    );
    expect(createAuditLog).toHaveBeenCalled();
  });

  it('uses an explicit slug over the derived one', async () => {
    await request(app).post('/api/locations').set(auth()).send({ name: 'Main', slug: 'custom-slug' });

    expect(createLocation).toHaveBeenCalledWith(expect.objectContaining({ slug: 'custom-slug' }));
  });

  it('rejects a missing name', async () => {
    const response = await request(app).post('/api/locations').set(auth()).send({});

    expect(response.status).toBe(400);
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('rejects an over-long name', async () => {
    const response = await request(app)
      .post('/api/locations')
      .set(auth())
      .send({ name: 'x'.repeat(256) });

    expect(response.status).toBe(400);
  });

  it('409s on a duplicate slug', async () => {
    createLocation.mockResolvedValue('duplicate_slug');

    const response = await request(app).post('/api/locations').set(auth()).send({ name: 'Main' });

    expect(response.status).toBe(409);
  });

  it('needs registers.write, not merely read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect(
      (await request(app).post('/api/locations').set(auth()).send({ name: 'Main' })).status
    ).toBe(403);
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('401s without a token', async () => {
    expect((await request(app).post('/api/locations').send({ name: 'Main' })).status).toBe(401);
  });
});

describe('PATCH /api/locations/:id', () => {
  it('updates one', async () => {
    const response = await request(app)
      .patch('/api/locations/loc-1')
      .set(auth())
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { name: 'Renamed' });
  });

  it('clears a nullable field when sent explicit null', async () => {
    await request(app).patch('/api/locations/loc-1').set(auth()).send({ address: null });

    expect(updateLocation).toHaveBeenCalledWith('loc-1', { address: null });
  });

  it('404s when it does not exist', async () => {
    getLocationById.mockResolvedValue(null);

    const response = await request(app).patch('/api/locations/nope').set(auth()).send({ name: 'X' });

    expect(response.status).toBe(404);
  });

  it('404s rather than leaks a location belonging to a different org', async () => {
    getLocationById.mockResolvedValue({ ...LOCATION, orgId: OTHER_ORG });

    const response = await request(app).patch('/api/locations/loc-1').set(auth()).send({ name: 'X' });

    expect(response.status).toBe(404);
  });

  it('409s on a duplicate slug', async () => {
    updateLocation.mockResolvedValue('duplicate_slug');

    const response = await request(app)
      .patch('/api/locations/loc-1')
      .set(auth())
      .send({ slug: 'taken' });

    expect(response.status).toBe(409);
  });

  it('rejects an invalid status', async () => {
    const response = await request(app)
      .patch('/api/locations/loc-1')
      .set(auth())
      .send({ status: 'on-fire' });

    expect(response.status).toBe(400);
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('needs registers.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect(
      (await request(app).patch('/api/locations/loc-1').set(auth()).send({ name: 'X' })).status
    ).toBe(403);
  });
});
