import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getUserById = vi.fn();
const getUserByEmail = vi.fn();
const resetPinFailures = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserById, getUserByEmail, resetPinFailures, createAuditLog }) },
}));

const { default: app } = await import('../../../app');
const { mintSession } = await import('../../../services/tillSessions');

const ORG = '00000000-0000-0000-0000-000000000001';

function actor(canWriteUsers: boolean) {
  return {
    id: 'admin1', email: 'admin@demo.local', name: 'Admin', status: 'active', orgId: ORG,
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', permissions: { users: { read: true, write: canWriteUsers } } }],
  };
}

const LOCKED = {
  id: 'u1', email: 'cashier@demo.local', name: 'Cashier', orgId: ORG,
  pinSetAt: 1000, pinLockedUntil: Date.now() + 600_000, pinFailedCount: 5,
};

function tokenFor(canWriteUsers: boolean) {
  const user = actor(canWriteUsers);
  getUserByEmail.mockResolvedValue(user);
  return mintSession({ user }).token;
}

const unlock = (token: string) =>
  request(app).post('/api/admin/users/u1/pin/unlock').set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  getUserById.mockResolvedValue(LOCKED);
  resetPinFailures.mockResolvedValue({ ...LOCKED, pinLockedUntil: null, pinFailedCount: 0 });
});

describe('POST /api/admin/users/:id/pin/unlock', () => {
  it('clears the lockout so the cashier need not wait it out', async () => {
    const response = await unlock(tokenFor(true));

    expect(response.status).toBe(200);
    expect(resetPinFailures).toHaveBeenCalledWith('u1');
    expect(response.body.data.pinLockedUntil).toBeNull();
  });

  it('leaves the PIN itself alone, so the cashier can still use it', async () => {
    // Unlocking is not resetting: the cashier's own PIN must still work.
    const response = await unlock(tokenFor(true));

    expect(response.body.data.pinSetAt).toBe(1000);
  });

  it('never returns the PIN hash', async () => {
    resetPinFailures.mockResolvedValue({ ...LOCKED, pinHash: 'SHOULD-NOT-LEAK', pinLockedUntil: null });

    const response = await unlock(tokenFor(true));

    expect(JSON.stringify(response.body)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('is audited', async () => {
    await unlock(tokenFor(true));

    expect(createAuditLog).toHaveBeenCalled();
  });

  it('needs users:write', async () => {
    const response = await unlock(tokenFor(false));

    expect(response.status).toBe(403);
    expect(resetPinFailures).not.toHaveBeenCalled();
  });

  it('is refused with no session at all', async () => {
    const response = await request(app).post('/api/admin/users/u1/pin/unlock');

    expect(response.status).toBe(401);
    expect(resetPinFailures).not.toHaveBeenCalled();
  });

  it('404s for a user who does not exist', async () => {
    getUserById.mockResolvedValue(null);

    const response = await unlock(tokenFor(true));

    expect(response.status).toBe(404);
  });

  it('404s for a user in another org, rather than confirming they exist', async () => {
    getUserById.mockResolvedValue({ ...LOCKED, orgId: 'another-org' });

    const response = await unlock(tokenFor(true));

    expect(response.status).toBe(404);
    expect(resetPinFailures).not.toHaveBeenCalled();
  });
});
