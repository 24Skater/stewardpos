import { expect, it } from 'vitest';
import { DEFAULT_ORG, describeSqlite, seedOrg, seedUser, useFreshSqlite } from './sqliteHarness';

/**
 * Users, roles, lockout counters, PINs, settings, the audit log and API keys
 * on SQLite. Mirrors the Postgres identity, passwordLockout, pinsAndShifts,
 * settingsKeys and remainingReads integration suites.
 */

const OTHER_ORG = '00000000-0000-0000-0000-0000000000c9';

describeSqlite('users and roles on SQLite', () => {
  const h = useFreshSqlite();

  it('writes a user with its roles, and reassembles roles and permissions on login read', async () => {
    const admin = await h.adapter.createRole({ name: 'Admin', systemRole: 'admin', permissions: { all: true } });
    const clerk = await h.adapter.createRole({ name: 'Clerk', permissions: { sell: true } });

    const user = await h.adapter.createUser({
      email: 'ada@example.com', passwordHash: 'h', name: 'Ada', roleIds: [admin.id, clerk.id],
    });
    const read = await h.adapter.getUserByEmail('ada@example.com');

    expect(user).toMatchObject({ status: 'active', roleIds: [admin.id, clerk.id] });
    expect(read).toMatchObject({ passwordHash: 'h', status: 'active', orgId: null, passwordFailedCount: 0, passwordLockedUntil: null });
    expect((read!.roles as Record<string, unknown>[]).map((r) => [r.name, r.systemRole, r.permissions]).sort()).toEqual([
      ['Admin', 'admin', { all: true }],
      ['Clerk', null, { sell: true }],
    ]);
  });

  it('returns a user with no roles, and null for an unknown address', async () => {
    await seedUser(h.adapter, 'solo@example.com');

    expect(await h.adapter.getUserByEmail('solo@example.com')).toMatchObject({ roleIds: [], roles: [] });
    expect(await h.adapter.getUserByEmail('nobody@example.com')).toBeNull();
  });

  it('refuses a duplicate email as a DatabaseError', async () => {
    await seedUser(h.adapter, 'dup@example.com');

    await expect(seedUser(h.adapter, 'dup@example.com')).rejects.toThrow('Failed to create user');
  });

  it('lists users without any PIN hash, and updates one without blanking the rest', async () => {
    const role = await h.adapter.createRole({ name: 'Clerk', permissions: {} });
    const id = await seedUser(h.adapter, 'b@example.com', 'Bea');
    await seedUser(h.adapter, 'a@example.com', 'Al');
    await h.adapter.setUserPin(id, { pinHash: 'pin-hash', pinSetAt: 5 });

    const updated = await h.adapter.updateUser(id, { status: 'suspended', canOverride: true, roleIds: [role.id] });
    const users = await h.adapter.getAllUsers();

    expect(updated).toMatchObject({ name: 'Bea', email: 'b@example.com', status: 'suspended' });
    expect(users.map((u) => u.name)).toEqual(['Al', 'Bea']);
    expect(users[1]).toMatchObject({ pinSetAt: 5, pinLockedUntil: null, roleIds: [role.id] });
    expect(JSON.stringify(users)).not.toContain('pin-hash');
    expect((await h.adapter.getUserById(id))!.canOverride).toBe(true);
  });

  it('updates name, email and password, and leaves an empty patch harmless', async () => {
    const id = await seedUser(h.adapter, 'old@example.com', 'Old');

    await h.adapter.updateUser(id, { name: 'New', email: 'new@example.com', passwordHash: 'h2' });

    expect(await h.adapter.getUserByEmail('new@example.com')).toMatchObject({ name: 'New', passwordHash: 'h2' });
    expect(await h.adapter.updateUser(id, {})).toMatchObject({ name: 'New' });
    expect(await h.adapter.updateUser('missing', { name: 'x' })).toBeNull();
  });

  it('stamps last login, and deletes users and roles', async () => {
    const role = await h.adapter.createRole({ name: 'Temp', permissions: {} });
    const id = await seedUser(h.adapter, 'gone@example.com');

    await h.adapter.updateUserLastLogin(id);

    expect((await h.adapter.getUserByEmail('gone@example.com'))!.lastLoginAt).toEqual(expect.any(Number));
    expect(await h.adapter.deleteUser(id)).toBe(true);
    expect(await h.adapter.deleteUser(id)).toBe(false);
    expect(await h.adapter.deleteRole(String(role.id))).toBe(true);
    expect(await h.adapter.deleteRole(String(role.id))).toBe(false);
  });

  it('reads, lists and COALESCE-updates roles', async () => {
    const role = await h.adapter.createRole({ name: 'Clerk', systemRole: 'staff', permissions: { a: 1 } });
    const id = String(role.id);

    expect(await h.adapter.updateRole(id, { permissions: { a: 2 } })).toMatchObject({ name: 'Clerk', systemRole: 'staff', permissions: { a: 2 } });
    expect(await h.adapter.updateRole(id, { name: 'Cashier' })).toMatchObject({ name: 'Cashier', permissions: { a: 2 } });
    expect(await h.adapter.getRoleById(id)).toMatchObject({ name: 'Cashier' });
    expect(await h.adapter.getAllRoles()).toHaveLength(1);
    expect(await h.adapter.getRoleById('missing')).toBeNull();
    expect(await h.adapter.updateRole('missing', { name: 'x' })).toBeNull();
  });

  it('reports a reachable database', async () => {
    expect(await h.adapter.testConnection()).toBe(true);
  });
});

describeSqlite('password lockout on SQLite', () => {
  const h = useFreshSqlite();

  it('records a failure and lockout, reads it through the login path, and clears both on reset', async () => {
    const id = await seedUser(h.adapter, 'lock@example.com');
    const until = Date.now() + 60_000;

    await h.adapter.recordPasswordFailure(id, { failedCount: 5, lockedUntil: until });

    expect(await h.adapter.getUserByEmail('lock@example.com')).toMatchObject({ passwordFailedCount: 5, passwordLockedUntil: until });
    expect((await h.adapter.getAllUsers())[0]).toMatchObject({ passwordLockedUntil: until });

    await h.adapter.resetPasswordFailures(id);
    expect(await h.adapter.getUserByEmail('lock@example.com')).toMatchObject({ passwordFailedCount: 0, passwordLockedUntil: null });
  });

  it('keeps the password lockout independent of the PIN lockout', async () => {
    const id = await seedUser(h.adapter, 'both@example.com');

    await h.adapter.recordPinFailure(id, { failedCount: 3, lockedUntil: 99 });
    await h.adapter.resetPasswordFailures(id);

    expect(await h.adapter.getUserById(id)).toMatchObject({ pinFailedCount: 3, pinLockedUntil: 99 });
  });
});

describeSqlite('PINs on SQLite', () => {
  const h = useFreshSqlite();

  it('sets a PIN without returning the hash, clearing any prior lockout', async () => {
    const id = await seedUser(h.adapter, 'pin@example.com');
    await h.adapter.recordPinFailure(id, { failedCount: 5, lockedUntil: Date.now() + 1_000 });

    const set = await h.adapter.setUserPin(id, { pinHash: 'secret-hash', pinSetAt: 42 });

    expect(set).toEqual({ id, email: 'pin@example.com', name: 'pin', status: 'active', pinSetAt: 42 });
    expect(await h.adapter.getUserById(id)).toMatchObject({ pinHash: 'secret-hash', pinFailedCount: 0, pinLockedUntil: null });
    expect(await h.adapter.setUserPin('missing', { pinHash: null, pinSetAt: null })).toBeNull();
    expect(await h.adapter.getUserById('missing')).toBeNull();
  });

  it('resets the PIN failure counter and lock', async () => {
    const id = await seedUser(h.adapter, 'pin@example.com');
    await h.adapter.recordPinFailure(id, { failedCount: 2, lockedUntil: 10 });

    await h.adapter.resetPinFailures(id);

    expect(await h.adapter.getUserById(id)).toMatchObject({ pinFailedCount: 0, pinLockedUntil: null });
  });

  it('lists active PIN holders per org, treating a NULL org as the default and hiding other orgs', async () => {
    seedOrg(h.db, OTHER_ORG, 'other');
    const legacy = await seedUser(h.adapter, 'legacy@example.com');
    const theirs = await seedUser(h.adapter, 'theirs@example.com');
    const inactive = await seedUser(h.adapter, 'inactive@example.com');
    const approver = await seedUser(h.adapter, 'mgr@example.com');
    await seedUser(h.adapter, 'nopin@example.com');
    for (const id of [legacy, theirs, inactive, approver]) await h.adapter.setUserPin(id, { pinHash: 'h', pinSetAt: 1 });
    h.db.prepare('UPDATE users SET org_id = ? WHERE id = ?').run(OTHER_ORG, theirs);
    await h.adapter.updateUser(inactive, { status: 'inactive' });
    await h.adapter.updateUser(approver, { canOverride: true });

    const mine = await h.adapter.getActiveUsersWithPin(DEFAULT_ORG);
    const other = await h.adapter.getActiveUsersWithPin(OTHER_ORG);
    const approvers = await h.adapter.getActiveUsersWithOverridePermission(DEFAULT_ORG);

    expect(mine.map((u) => u.id).sort()).toEqual([legacy, approver].sort());
    expect(other.map((u) => u.id)).toEqual([theirs]);
    expect(approvers.map((u) => u.id)).toEqual([approver]);
    expect(await h.adapter.getActiveUsersWithOverridePermission(OTHER_ORG)).toEqual([]);
  });
});

describeSqlite('settings on SQLite', () => {
  const h = useFreshSqlite();

  it('reads nothing before the first write, then inserts the single row with defaults', async () => {
    expect(await h.adapter.getSettings()).toBeNull();

    const created = await h.adapter.updateSettings({ storeEmail: 'shop@example.com', config: { theme: 'dark' } });

    expect(created).toMatchObject({
      storeName: 'StewardPOS', timezone: 'UTC', taxRateDefault: 0, storeEmail: 'shop@example.com',
      config: { theme: 'dark' }, receiptShowLogo: true, receiptShowBarcode: true,
    });
  });

  it('leaves other fields and stored config alone on a partial update, and stays one row', async () => {
    await h.adapter.updateSettings({ storeName: 'Corner Shop', taxRateDefault: 0.0825, config: { a: 1 } });

    const updated = await h.adapter.updateSettings({ storePhone: '555', receiptShowLogo: false });

    expect(updated).toMatchObject({ storeName: 'Corner Shop', taxRateDefault: 0.0825, storePhone: '555', config: { a: 1 }, receiptShowLogo: false });
    expect(await h.adapter.getSettings()).toMatchObject({ receiptShowLogo: false, receiptShowBarcode: true });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
  });
});

describeSqlite('audit log on SQLite', () => {
  const h = useFreshSqlite();

  it('records entries, including unattributed ones, and reads them newest first with the user named', async () => {
    const user = await seedUser(h.adapter, 'auditor@example.com', 'Auditor');
    const first = await h.adapter.createAuditLog({ userId: user, action: 'create', entity: 'product', entityId: 'p1', after: { name: 'A' } });
    const second = await h.adapter.createAuditLog({ actorLabel: 'register:MAIN-01', action: 'sale', entity: 'order', entityId: 'o1' });
    h.db.prepare('UPDATE audit_logs SET timestamp = ? WHERE id = ?').run(1_000, first.id);

    const { logs, total } = await h.adapter.getAuditLogs();

    expect(total).toBe(2);
    expect(logs.map((l) => l.id)).toEqual([second.id, first.id]);
    expect(logs[0]).toMatchObject({ userId: null, actorLabel: 'register:MAIN-01', before: null });
    expect(logs[1]).toMatchObject({ userName: 'Auditor', after: { name: 'A' } });
  });

  it('combines entity, action, user and date filters, and pages with the full total', async () => {
    const user = await seedUser(h.adapter, 'auditor@example.com');
    for (let i = 0; i < 3; i++) {
      await h.adapter.createAuditLog({ userId: user, action: 'update', entity: 'product', entityId: `p${i}`, before: { i } });
    }
    const other = await h.adapter.createAuditLog({ action: 'update', entity: 'order', entityId: 'o' });
    h.db.prepare('UPDATE audit_logs SET timestamp = ? WHERE id = ?').run(5_000, other.id);

    const paged = await h.adapter.getAuditLogs({ entity: 'product', action: 'update', userId: user, limit: 2, offset: 0 });
    const dated = await h.adapter.getAuditLogs({ from: 4_000, to: 6_000 });

    expect(paged.total).toBe(3);
    expect(paged.logs).toHaveLength(2);
    expect(dated.logs.map((l) => l.id)).toEqual([other.id]);
  });

  it('wraps a missing required field as a DatabaseError', async () => {
    await expect(h.adapter.createAuditLog({ action: 'x' })).rejects.toThrow('Failed to create audit log');
  });
});

describeSqlite('API keys on SQLite', () => {
  const h = useFreshSqlite();

  it('creates a key, reads it by id and prefix with scopes as an array, and lists it', async () => {
    const owner = await seedUser(h.adapter, 'owner@example.com', 'Owner');
    const created = await h.adapter.createApiKey({ name: 'CI', keyPrefix: 'sk_ab', keyHash: 'hash', scopes: ['read', 'write'], createdBy: owner });
    const defaults = await h.adapter.createApiKey({ name: 'Default', keyPrefix: 'sk_cd', keyHash: 'h2' });

    expect(defaults).toMatchObject({ scopes: ['read'], rateLimit: 1000, isActive: true });
    expect(await h.adapter.getApiKeyById(String(created.id))).toMatchObject({ scopes: ['read', 'write'], createdByName: 'Owner', isActive: true });
    expect(await h.adapter.getApiKeyByPrefix('sk_ab')).toMatchObject({ id: created.id, keyHash: 'hash' });
    expect(await h.adapter.getAllApiKeys()).toHaveLength(2);
    expect(await h.adapter.getApiKeyByPrefix('sk_zz')).toBeNull();
    expect(await h.adapter.getApiKeyById('missing')).toBeNull();
  });

  it('stops resolving a revoked key by prefix, updates without blanking, and records last use', async () => {
    const created = await h.adapter.createApiKey({ name: 'CI', description: 'pipeline', keyPrefix: 'sk_ab', keyHash: 'hash' });
    const id = String(created.id);

    const updated = await h.adapter.updateApiKey(id, { isActive: false, scopes: ['admin'] });
    await h.adapter.updateApiKeyLastUsed(id);

    expect(updated).toMatchObject({ name: 'CI', description: 'pipeline', isActive: false, scopes: ['admin'] });
    expect(await h.adapter.getApiKeyByPrefix('sk_ab')).toBeNull();
    expect((await h.adapter.getApiKeyById(id))!.lastUsedAt).toEqual(expect.any(Number));
    expect(await h.adapter.updateApiKey('missing', { name: 'x' })).toBeNull();
    expect(await h.adapter.deleteApiKey(id)).toBe(true);
    expect(await h.adapter.deleteApiKey(id)).toBe(false);
  });

  it('wraps a missing hash as a DatabaseError', async () => {
    await expect(h.adapter.createApiKey({ name: 'Bad', keyPrefix: 'x' })).rejects.toThrow('Failed to create API key');
  });
});

describeSqlite('feature settings on SQLite', () => {
  const h = useFreshSqlite();

  it('round-trips features and providers, defaulting to empty', async () => {
    const created = await h.adapter.updateSettings({ storeName: 'S' });
    expect(created).toMatchObject({ features: {}, providers: {} });

    const patch = { features: { tips: true }, providers: { email: 'smtp' } };
    expect(await h.adapter.updateSettings(patch)).toMatchObject(patch);
    expect(await h.adapter.getSettings()).toMatchObject(patch);
  });
});
