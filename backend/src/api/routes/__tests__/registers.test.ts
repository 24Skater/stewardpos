import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getRegisters = vi.fn();
const getRegisterById = vi.fn();
const getLocationById = vi.fn();
const getOrgPolicy = vi.fn();
const countRegistersForCap = vi.fn();
const getUsedRegisterNumbers = vi.fn();
const createRegister = vi.fn();
const updateRegister = vi.fn();
const setRegisterStatus = vi.fn();
const createAuditLog = vi.fn();
// retireRegister/disableRegister now end any open shift on the register —
// see services/registers.ts's endOpenShift — so this mock needs the same
// shift surface registerShifts.getOpenShift reads.
const getOpenShiftForRegister = vi.fn();
const endRegisterShift = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getRegisters,
      getRegisterById,
      getLocationById,
      getOrgPolicy,
      countRegistersForCap,
      getUsedRegisterNumbers,
      createRegister,
      updateRegister,
      setRegisterStatus,
      createAuditLog,
      getOpenShiftForRegister,
      endRegisterShift,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../../middleware/auth');
const { default: app } = await import('../../../app');

const OTHER_ORG = '11111111-1111-1111-1111-111111111111';

const LOCATION = { id: 'loc-1', orgId: DEFAULT_ORG_ID, name: 'Main', slug: 'main' };

const REGISTER = {
  id: 'r1',
  orgId: DEFAULT_ORG_ID,
  locationId: 'loc-1',
  name: 'Register 1',
  registerNumber: 1,
  displayCode: 'MAIN-01',
  status: 'pending',
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
  getRegisters.mockResolvedValue([REGISTER]);
  getRegisterById.mockResolvedValue(REGISTER);
  getLocationById.mockResolvedValue(LOCATION);
  getOrgPolicy.mockResolvedValue(null);
  countRegistersForCap.mockResolvedValue(0);
  getUsedRegisterNumbers.mockResolvedValue([]);
  createRegister.mockResolvedValue(REGISTER);
  updateRegister.mockResolvedValue(REGISTER);
  setRegisterStatus.mockResolvedValue(REGISTER);
  createAuditLog.mockResolvedValue({});
  getOpenShiftForRegister.mockResolvedValue(null);
});

describe('GET /api/registers', () => {
  it('lists registers for the org', async () => {
    const response = await request(app).get('/api/registers').set(auth());

    expect(response.status).toBe(200);
    // 'never' — REGISTER carries no lastSeenAt, so derived liveness reads as
    // "has not enrolled a heartbeating device yet", distinct from 'offline'.
    expect(response.body.data).toEqual([{ ...REGISTER, liveness: 'never' }]);
    expect(getRegisters).toHaveBeenCalledWith({ orgId: DEFAULT_ORG_ID, locationId: undefined, status: undefined });
  });

  it('passes locationId and status query filters through', async () => {
    await request(app).get('/api/registers?locationId=loc-1&status=active').set(auth());

    expect(getRegisters).toHaveBeenCalledWith({ orgId: DEFAULT_ORG_ID, locationId: 'loc-1', status: 'active' });
  });

  it('rejects an unrecognised status value', async () => {
    const response = await request(app).get('/api/registers?status=bogus').set(auth());

    expect(response.status).toBe(400);
    expect(getRegisters).not.toHaveBeenCalled();
  });

  it('needs registers.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: false } }));

    expect((await request(app).get('/api/registers').set(auth())).status).toBe(403);
  });

  it('401s without a token', async () => {
    expect((await request(app).get('/api/registers')).status).toBe(401);
  });
});

describe('GET /api/registers/:id', () => {
  it('gets one', async () => {
    const response = await request(app).get('/api/registers/r1').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ ...REGISTER, liveness: 'never' });
  });

  it('404s when it does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    expect((await request(app).get('/api/registers/nope').set(auth())).status).toBe(404);
  });

  it('404s rather than leaks a register belonging to a different org', async () => {
    getRegisterById.mockResolvedValue({ ...REGISTER, orgId: OTHER_ORG });

    expect((await request(app).get('/api/registers/r1').set(auth())).status).toBe(404);
  });

  it('needs registers.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: false } }));

    expect((await request(app).get('/api/registers/r1').set(auth())).status).toBe(403);
  });
});

describe('POST /api/registers', () => {
  const BODY = { locationId: 'loc-1', name: 'Register 2' };

  it('creates one', async () => {
    const response = await request(app).post('/api/registers').set(auth()).send(BODY);

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(REGISTER);
    expect(createRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: DEFAULT_ORG_ID,
        location_id: 'loc-1',
        name: 'Register 2',
        register_number: 1,
        display_code: 'MAIN-01',
      })
    );
    expect(createAuditLog).toHaveBeenCalled();
  });

  it('rejects a missing name', async () => {
    const response = await request(app)
      .post('/api/registers')
      .set(auth())
      .send({ locationId: 'loc-1' });

    expect(response.status).toBe(400);
    expect(createRegister).not.toHaveBeenCalled();
  });

  it('rejects an over-long name', async () => {
    const response = await request(app)
      .post('/api/registers')
      .set(auth())
      .send({ ...BODY, name: 'x'.repeat(256) });

    expect(response.status).toBe(400);
  });

  it('400s when the location does not exist or belongs to another org', async () => {
    getLocationById.mockResolvedValue(null);

    const response = await request(app).post('/api/registers').set(auth()).send(BODY);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/location/i);
  });

  it('422s when the org has reached its register cap', async () => {
    getOrgPolicy.mockResolvedValue({ maxRegisters: 3, pinLength: 6 });
    countRegistersForCap.mockResolvedValue(3);

    const response = await request(app).post('/api/registers').set(auth()).send(BODY);

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/3/);
    expect(createRegister).not.toHaveBeenCalled();
  });

  it('409s on a duplicate register number', async () => {
    createRegister.mockResolvedValue('duplicate_number');

    const response = await request(app).post('/api/registers').set(auth()).send(BODY);

    expect(response.status).toBe(409);
  });

  it('409s on a duplicate display code', async () => {
    createRegister.mockResolvedValue('duplicate_code');

    const response = await request(app).post('/api/registers').set(auth()).send(BODY);

    expect(response.status).toBe(409);
  });

  it('needs registers.write, not merely read', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect((await request(app).post('/api/registers').set(auth()).send(BODY)).status).toBe(403);
    expect(createRegister).not.toHaveBeenCalled();
  });

  it('401s without a token', async () => {
    expect((await request(app).post('/api/registers').send(BODY)).status).toBe(401);
  });
});

describe('PATCH /api/registers/:id', () => {
  it('updates one', async () => {
    const response = await request(app)
      .patch('/api/registers/r1')
      .set(auth())
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(updateRegister).toHaveBeenCalledWith('r1', { name: 'Renamed' });
  });

  it('uppercases a displayCode override before sending it to the adapter', async () => {
    await request(app).patch('/api/registers/r1').set(auth()).send({ displayCode: 'main-02' });

    expect(updateRegister).toHaveBeenCalledWith('r1', { display_code: 'MAIN-02' });
  });

  it('404s when it does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    const response = await request(app).patch('/api/registers/nope').set(auth()).send({ name: 'X' });

    expect(response.status).toBe(404);
  });

  it('404s rather than leaks a register belonging to a different org', async () => {
    getRegisterById.mockResolvedValue({ ...REGISTER, orgId: OTHER_ORG });

    const response = await request(app).patch('/api/registers/r1').set(auth()).send({ name: 'X' });

    expect(response.status).toBe(404);
  });

  it('409s on a duplicate display code', async () => {
    updateRegister.mockResolvedValue('duplicate_code');

    const response = await request(app)
      .patch('/api/registers/r1')
      .set(auth())
      .send({ displayCode: 'MAIN-02' });

    expect(response.status).toBe(409);
  });

  it('rejects an invalid type', async () => {
    const response = await request(app)
      .patch('/api/registers/r1')
      .set(auth())
      .send({ type: 'toaster' });

    expect(response.status).toBe(400);
    expect(updateRegister).not.toHaveBeenCalled();
  });

  it('needs registers.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect(
      (await request(app).patch('/api/registers/r1').set(auth()).send({ name: 'X' })).status
    ).toBe(403);
  });
});

describe('POST /api/registers/:id/retire', () => {
  it('retires one', async () => {
    setRegisterStatus.mockResolvedValue({ ...REGISTER, status: 'retired' });

    const response = await request(app).post('/api/registers/r1/retire').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('retired');
    expect(setRegisterStatus).toHaveBeenCalledWith('r1', 'retired');
    expect(createAuditLog).toHaveBeenCalled();
  });

  it('404s when it does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    expect((await request(app).post('/api/registers/nope/retire').set(auth())).status).toBe(404);
  });

  it('needs registers.delete, not merely write', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: true, delete: false } }));

    expect((await request(app).post('/api/registers/r1/retire').set(auth())).status).toBe(403);
    expect(setRegisterStatus).not.toHaveBeenCalled();
  });
});

describe('POST /api/registers/:id/disable', () => {
  it('disables one', async () => {
    setRegisterStatus.mockResolvedValue({ ...REGISTER, status: 'disabled' });

    const response = await request(app).post('/api/registers/r1/disable').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('disabled');
    expect(setRegisterStatus).toHaveBeenCalledWith('r1', 'disabled');
  });

  it('404s when it does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    expect((await request(app).post('/api/registers/nope/disable').set(auth())).status).toBe(404);
  });

  it('needs registers.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect((await request(app).post('/api/registers/r1/disable').set(auth())).status).toBe(403);
  });
});

describe('POST /api/registers/:id/activate', () => {
  it('activates one', async () => {
    setRegisterStatus.mockResolvedValue({ ...REGISTER, status: 'active' });

    const response = await request(app).post('/api/registers/r1/activate').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('active');
    expect(setRegisterStatus).toHaveBeenCalledWith('r1', 'active');
  });

  it('404s when it does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    expect((await request(app).post('/api/registers/nope/activate').set(auth())).status).toBe(404);
  });

  it('needs registers.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ registers: { read: true, write: false } }));

    expect((await request(app).post('/api/registers/r1/activate').set(auth())).status).toBe(403);
  });
});
