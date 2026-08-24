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

  it('redacts a PIN hash in both casings, and a raw pin field, but keeps the rest of the row', async () => {
    await audit(req, {
      action: 'update',
      entity: 'user',
      entityId: 'u1',
      after: { name: 'Casey', pin: '123456', pinHash: '$2a$10$fakehash', pin_hash: '$2a$10$fakehash' },
    });

    const written = createAuditLog.mock.calls[0][0];
    expect(written.after.pin).toBe('[redacted]');
    expect(written.after.pinHash).toBe('[redacted]');
    expect(written.after.pin_hash).toBe('[redacted]');
    expect(written.after.name).toBe('Casey');
    expect(JSON.stringify(written)).not.toContain('123456');
    expect(JSON.stringify(written)).not.toContain('$2a$10$fakehash');
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

  /**
   * A till request carries no `req.user` — it is authenticated by the device
   * credential, not a session — but the routes that open and close a shift
   * know exactly whose PIN just matched. Without this the audit trail would
   * say only that *somebody* signed on, which is the one question the shift
   * log exists to answer.
   */
  it('attributes an action to the actor a session-less route names', async () => {
    await audit({} as never, {
      action: 'create',
      entity: 'register_shift',
      entityId: 's1',
      actorUserId: 'cashier-9',
    });

    expect(createAuditLog.mock.calls[0][0].userId).toBe('cashier-9');
  });

  it('prefers the named actor over the session user, since the till knows better', async () => {
    await audit(req, {
      action: 'update',
      entity: 'register_shift',
      entityId: 's1',
      actorUserId: 'cashier-9',
    });

    expect(createAuditLog.mock.calls[0][0].userId).toBe('cashier-9');
  });

  /**
   * `audit_logs.user_id` is a UUID with a foreign key to `users`. A non-human
   * principal's id is neither: `authenticate` mints `register:<uuid>` for a
   * no-PIN till session and `api-key:<uuid>` for a key, both shaped for the
   * permission system rather than for this table. Writing one there fails the
   * insert outright — and `audit()` never throws — so every action an API key
   * ever performed was discarded in silence. The label keeps the row.
   */
  it('does not put a synthetic api-key principal in a column that holds user ids', async () => {
    await audit(
      { user: { id: 'api-key:11111111-1111-1111-1111-111111111111', email: 'api-key:Nightly sync' } } as never,
      { action: 'update', entity: 'product', entityId: 'p1' }
    );

    const written = createAuditLog.mock.calls[0][0];
    expect(written.userId).toBeNull();
    expect(written.actorLabel).toBe('api-key:Nightly sync');
  });

  it('does the same for a register principal, which is a till with nobody signed on', async () => {
    await audit(
      { user: { id: 'register:22222222-2222-2222-2222-222222222222', email: 'register:22222222-2222-2222-2222-222222222222' } } as never,
      { action: 'create', entity: 'order', entityId: 'o1' }
    );

    const written = createAuditLog.mock.calls[0][0];
    expect(written.userId).toBeNull();
    expect(written.actorLabel).toBe('register:22222222-2222-2222-2222-222222222222');
  });

  it('leaves an ordinary user id alone', async () => {
    await audit(req, { action: 'update', entity: 'product', entityId: 'p1' });

    const written = createAuditLog.mock.calls[0][0];
    expect(written.userId).toBe('user-1');
    expect(written.actorLabel).toBeNull();
  });
});
