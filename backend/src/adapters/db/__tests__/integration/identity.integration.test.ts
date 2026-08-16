import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Users, roles, customers, and audit SQL against a real Postgres.
 *
 * `createUser` writes across `users` and `user_roles` in a transaction, and
 * `getUserByEmail` reassembles roles and permissions through two joins — the
 * query that every authenticated request depends on, and the one that decides
 * what a person is allowed to do. A mocked adapter hands the middleware a
 * hand-written object and proves none of it.
 */
let h: Harness;
const mark = tag();

const userIds: string[] = [];
const roleIds: string[] = [];
const customerIds: string[] = [];

async function makeRole(name: string, permissions: Record<string, unknown>, systemRole = 'standard') {
  const { rows } = await h.query(
    'INSERT INTO roles (name, system_role, permissions) VALUES ($1, $2, $3) RETURNING id',
    [name, systemRole, JSON.stringify(permissions)]
  );
  roleIds.push(String(rows[0].id));
  return String(rows[0].id);
}

async function makeUser(email: string, roles: string[] = [], status = 'active') {
  const created = await h.adapter.createUser({
    email,
    passwordHash: 'not-a-real-hash',
    name: `${mark} person`,
    status,
    roleIds: roles,
  });
  userIds.push(String(created.id));
  return created;
}

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  if (userIds.length > 0) {
    await h.query('DELETE FROM user_roles WHERE user_id = ANY($1)', [userIds]);
    await h.query('DELETE FROM audit_logs WHERE user_id = ANY($1)', [userIds]);
    await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  if (roleIds.length > 0) {
    await h.query('DELETE FROM user_roles WHERE role_id = ANY($1)', [roleIds]);
    await h.query('DELETE FROM roles WHERE id = ANY($1)', [roleIds]);
  }
  if (customerIds.length > 0) {
    await h.query('DELETE FROM customers WHERE id = ANY($1)', [customerIds]);
  }
  await h.close();
});

describe('createUser', () => {
  it('writes the user and its role assignments together', async () => {
    const roleId = await makeRole(`${mark} Cashier`, { orders: { read: true } });

    const user = await makeUser(`${mark}-a@example.com`, [roleId]);

    const { rows } = await h.query('SELECT role_id FROM user_roles WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].role_id)).toBe(roleId);
  });

  it('assigns several roles', async () => {
    const a = await makeRole(`${mark} A`, { orders: { read: true } });
    const b = await makeRole(`${mark} B`, { inventory: { read: true } });

    const user = await makeUser(`${mark}-b@example.com`, [a, b]);

    const { rows } = await h.query('SELECT role_id FROM user_roles WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(2);
  });
});

describe('getUserByEmail', () => {
  it('reassembles roles and their permissions', async () => {
    // This is what `authenticate` reads on every request to decide what the
    // caller may do. The permissions column is JSON and comes back through a
    // json_agg; if that shape drifts, every authorisation check silently sees
    // an empty object and denies everything.
    const roleId = await makeRole(`${mark} Manager`, {
      orders: { read: true, write: true },
      inventory: { read: true },
    });
    await makeUser(`${mark}-c@example.com`, [roleId]);

    const user = await h.adapter.getUserByEmail(`${mark}-c@example.com`);

    const roles = user!.roles as Array<Record<string, unknown>>;
    expect(roles).toHaveLength(1);
    expect(roles[0].permissions).toMatchObject({ orders: { read: true, write: true } });
  });

  it('carries the systemRole, which is what grants the admin bypass', async () => {
    const roleId = await makeRole(`${mark} Boss`, {}, 'admin');
    await makeUser(`${mark}-d@example.com`, [roleId]);

    const user = await h.adapter.getUserByEmail(`${mark}-d@example.com`);

    expect((user!.roles as Array<Record<string, unknown>>)[0].systemRole).toBe('admin');
  });

  it('returns a user with no roles rather than failing', async () => {
    // The FILTER on the aggregate exists for this: a LEFT JOIN with no match
    // would otherwise produce a single null role, and the permission check
    // would read properties off it.
    await makeUser(`${mark}-e@example.com`, []);

    const user = await h.adapter.getUserByEmail(`${mark}-e@example.com`);

    expect(user!.roles).toEqual([]);
    expect(user!.roleIds).toEqual([]);
  });

  it('reports status, so a suspended account can be refused', async () => {
    await makeUser(`${mark}-f@example.com`, [], 'suspended');

    const user = await h.adapter.getUserByEmail(`${mark}-f@example.com`);

    expect(user!.status).toBe('suspended');
  });

  it('returns null for an unknown address', async () => {
    expect(await h.adapter.getUserByEmail(`${mark}-nobody@example.com`)).toBeNull();
  });

  it('carries orgId, defaulting to null before a second org exists', async () => {
    await makeUser(`${mark}-g@example.com`, []);

    const user = await h.adapter.getUserByEmail(`${mark}-g@example.com`);

    expect(user!.orgId).toBeNull();
  });
});

describe('customers', () => {
  it('creates and reads one back', async () => {
    const created = await h.adapter.createCustomer({
      name: `${mark} Buyer`,
      email: `${mark}-buyer@example.com`,
      phone: '555-0100',
    });
    customerIds.push(String(created.id));

    const found = await h.adapter.getCustomerById(String(created.id));
    expect(found).toMatchObject({ name: `${mark} Buyer`, email: `${mark}-buyer@example.com` });
  });

  it('updates without blanking the fields left out', async () => {
    const created = await h.adapter.createCustomer({
      name: `${mark} Keep`,
      email: `${mark}-keep@example.com`,
      phone: '555-0101',
    });
    customerIds.push(String(created.id));

    await h.adapter.updateCustomer(String(created.id), { name: `${mark} Renamed` });

    const found = await h.adapter.getCustomerById(String(created.id));
    expect(found).toMatchObject({ name: `${mark} Renamed`, phone: '555-0101' });
  });

  it('returns null for a customer that does not exist', async () => {
    expect(await h.adapter.getCustomerById('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});

describe('audit log', () => {
  it('records an entry and reads it back newest first', async () => {
    const user = await makeUser(`${mark}-h@example.com`, []);

    await h.adapter.createAuditLog({
      userId: user.id,
      userEmail: String(user.email),
      action: 'create',
      entity: 'product',
      // `audit_logs.entity_id` is a UUID column, so this cannot be an
      // arbitrary string. The singleton id used for settings is all-zeros for
      // exactly that reason.
      entityId: '00000000-0000-0000-0000-00000000beef',
    });

    const { logs, total } = await h.adapter.getAuditLogs({ userId: String(user.id) });
    expect(logs).toHaveLength(1);
    expect(total).toBe(1);
    expect(logs[0]).toMatchObject({ action: 'create', entity: 'product' });
  });

  it('pages, and reports the total it paged out of', async () => {
    // The total is counted before the LIMIT, which is the only way a caller can
    // tell a full page from the last one.
    const user = await makeUser(`${mark}-i@example.com`, []);
    for (const entity of ['product', 'order', 'customer']) {
      await h.adapter.createAuditLog({
        userId: user.id,
        userEmail: String(user.email),
        action: 'update',
        entity,
        entityId: '00000000-0000-0000-0000-00000000cafe',
      });
    }

    const page = await h.adapter.getAuditLogs({ userId: String(user.id), limit: 2 });
    expect(page.logs).toHaveLength(2);
    expect(page.total).toBe(3);

    const second = await h.adapter.getAuditLogs({ userId: String(user.id), limit: 2, offset: 2 });
    expect(second.logs).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  it('filters by entity', async () => {
    const user = await makeUser(`${mark}-j@example.com`, []);
    for (const entity of ['product', 'product', 'order']) {
      await h.adapter.createAuditLog({
        userId: user.id,
        userEmail: String(user.email),
        action: 'update',
        entity,
        entityId: '00000000-0000-0000-0000-00000000cafe',
      });
    }

    const products = await h.adapter.getAuditLogs({ userId: String(user.id), entity: 'product' });
    expect(products.total).toBe(2);
    expect(products.logs.every((log) => log.entity === 'product')).toBe(true);
  });

  it('filters by action', async () => {
    const user = await makeUser(`${mark}-k@example.com`, []);
    for (const action of ['create', 'delete']) {
      await h.adapter.createAuditLog({
        userId: user.id,
        userEmail: String(user.email),
        action,
        entity: 'product',
        entityId: '00000000-0000-0000-0000-00000000cafe',
      });
    }

    const deletes = await h.adapter.getAuditLogs({ userId: String(user.id), action: 'delete' });
    expect(deletes.total).toBe(1);
    expect(deletes.logs[0]).toMatchObject({ action: 'delete' });
  });

  it('filters by date, which is how "what changed on Tuesday" is answered', async () => {
    const user = await makeUser(`${mark}-l@example.com`, []);
    const log = await h.adapter.createAuditLog({
      userId: user.id,
      userEmail: String(user.email),
      action: 'update',
      entity: 'settings',
      entityId: '00000000-0000-0000-0000-000000000000',
    });
    await h.query('UPDATE audit_logs SET timestamp = $2 WHERE id = $1', [
      String(log.id),
      '2001-01-10T10:00:00.000Z',
    ]);

    const inRange = await h.adapter.getAuditLogs({
      userId: String(user.id),
      from: Date.parse('2001-01-01T00:00:00.000Z'),
      to: Date.parse('2001-01-31T23:59:59.999Z'),
    });
    const outOfRange = await h.adapter.getAuditLogs({
      userId: String(user.id),
      from: Date.parse('2002-01-01T00:00:00.000Z'),
      to: Date.parse('2002-01-31T23:59:59.999Z'),
    });

    expect(inRange.total).toBe(1);
    expect(outOfRange.total).toBe(0);
    expect(outOfRange.logs).toEqual([]);
  });

  it('combines filters rather than letting the last one win', async () => {
    const user = await makeUser(`${mark}-m@example.com`, []);
    for (const [action, entity] of [['create', 'product'], ['delete', 'product'], ['delete', 'order']]) {
      await h.adapter.createAuditLog({
        userId: user.id,
        userEmail: String(user.email),
        action,
        entity,
        entityId: '00000000-0000-0000-0000-00000000cafe',
      });
    }

    const both = await h.adapter.getAuditLogs({
      userId: String(user.id),
      action: 'delete',
      entity: 'product',
    });

    expect(both.total).toBe(1);
    expect(both.logs[0]).toMatchObject({ action: 'delete', entity: 'product' });
  });
});
