import { describe, it, expect, vi, beforeEach } from 'vitest';

const createAuditLog = vi.fn();

vi.mock('../database', () => ({
  default: { getAdapter: () => ({ createAuditLog }) },
}));

const { audit } = await import('../audit');

const req = { user: { id: 'user-1', email: 'a@b.c', roleIds: [], roles: [] } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  createAuditLog.mockResolvedValue({});
});

describe('audit', () => {
  it('records who did what to which record', async () => {
    await audit(req, { action: 'update', entity: 'product', entityId: 'p1', after: { name: 'Tea' } });

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'update',
        entity: 'product',
        entityId: 'p1',
      })
    );
  });

  it('redacts secrets rather than copying them into a browsable table', async () => {
    await audit(req, {
      action: 'update',
      entity: 'user',
      entityId: 'u1',
      after: { email: 'a@b.c', passwordHash: '$2a$10$realhash', name: 'A' },
    });

    const written = createAuditLog.mock.calls[0][0];
    expect(written.after.passwordHash).toBe('[redacted]');
    expect(written.after.email).toBe('a@b.c');
  });

  it('redacts nested secrets too', async () => {
    await audit(req, {
      action: 'update',
      entity: 'settings',
      entityId: 'store',
      after: { config: { terminalCredentials: { stripeSecretKey: 'sk_live_x' }, demoMode: false } },
    });

    const written = createAuditLog.mock.calls[0][0];
    expect(written.after.config.terminalCredentials).toBe('[redacted]');
    expect(JSON.stringify(written)).not.toContain('sk_live_x');
    expect(written.after.config.demoMode).toBe(false);
  });

  it('redacts through arrays', async () => {
    await audit(req, {
      action: 'update',
      entity: 'role',
      entityId: 'r1',
      after: { members: [{ name: 'A', token: 'tok_secret' }] },
    });

    expect(JSON.stringify(createAuditLog.mock.calls[0][0])).not.toContain('tok_secret');
  });

  it('omits before and after when they were not supplied', async () => {
    await audit(req, { action: 'delete', entity: 'product', entityId: 'p1' });

    const written = createAuditLog.mock.calls[0][0];
    expect(written.before).toBeUndefined();
    expect(written.after).toBeUndefined();
  });

  it('swallows a logging failure so it cannot undo the change it describes', async () => {
    // The mutation already succeeded by the time this runs; a broken audit write
    // must not turn a completed sale into a 500.
    createAuditLog.mockRejectedValue(new Error('audit table is gone'));

    await expect(
      audit(req, { action: 'create', entity: 'order', entityId: 'o1' })
    ).resolves.toBeUndefined();
  });

  it('still records the action when there is no user on the request', async () => {
    await audit({} as never, { action: 'create', entity: 'order', entityId: 'o1' });

    expect(createAuditLog.mock.calls[0][0].userId).toBeNull();
  });
});
