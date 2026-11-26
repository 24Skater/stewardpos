import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * The field-by-field update methods behind the admin screens — users, quotes,
 * locations, registers, variants — against a real Postgres. Each optional field
 * is its own branch of a hand-built SET clause, and the null-handling differs by
 * column: NOT NULL columns skip a null, nullable ones clear on it.
 */
let h: Harness;
const mark = tag();

let orgId: string;
let roleA: string;
let roleB: string;
const userIds: string[] = [];
const locationIds: string[] = [];
const registerIds: string[] = [];
const quoteIds: string[] = [];
const productIds: string[] = [];
const serviceIds: string[] = [];

const NIL = '00000000-0000-0000-0000-00000000dead';

beforeAll(async () => {
  h = await connect();
  orgId = String(
    (await h.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [`${mark} org`, `${mark}-org`]))
      .rows[0].id
  );
  const role = async (n: string) =>
    String(
      (await h.adapter.createRole({ name: `${mark} ${n}`, systemRole: 'standard', permissions: {} })).id
    );
  roleA = await role('A');
  roleB = await role('B');
}, 30_000);

afterAll(async () => {
  await h.query('DELETE FROM quote_items WHERE quote_id = ANY($1)', [quoteIds]);
  await h.query('DELETE FROM quotes WHERE id = ANY($1)', [quoteIds]);
  await h.query('DELETE FROM services WHERE id = ANY($1)', [serviceIds]);
  await h.query('DELETE FROM product_variants WHERE product_id = ANY($1)', [productIds]);
  await h.query('DELETE FROM products WHERE id = ANY($1)', [productIds]);
  await h.query('DELETE FROM registers WHERE id = ANY($1)', [registerIds]);
  await h.query('DELETE FROM locations WHERE id = ANY($1)', [locationIds]);
  await h.query('DELETE FROM user_roles WHERE user_id = ANY($1) OR role_id IN ($2, $3)', [userIds, roleA, roleB]);
  await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  await h.query('DELETE FROM roles WHERE id IN ($1, $2)', [roleA, roleB]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await h.close();
});

async function makeUser(roleIds: string[] = []) {
  const u = await h.adapter.createUser({
    email: `${mark}-${userIds.length}@example.com`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} User`,
    status: 'active',
    roleIds,
  });
  userIds.push(String(u.id));
  return String(u.id);
}

async function makeLocation(slug: string) {
  const loc = await h.adapter.createLocation({ org_id: orgId, name: `${mark} ${slug}`, slug: `${mark}-${slug}` });
  if (typeof loc === 'string') throw new Error(loc);
  locationIds.push(String(loc.id));
  return loc;
}

const rolesOf = async (userId: string) =>
  (await h.query('SELECT role_id FROM user_roles WHERE user_id = $1 ORDER BY role_id', [userId])).rows
    .map((r) => String(r.role_id))
    .sort();

describe('updateUser', () => {
  it('saves every scalar field and replaces the role set', async () => {
    const id = await makeUser([roleA]);

    await h.adapter.updateUser(id, {
      name: `${mark} Renamed`,
      email: `${mark}-renamed@example.com`,
      passwordHash: 'new-hash',
      status: 'inactive',
      canOverride: true,
      roleIds: [roleB],
    });

    const { rows } = await h.query('SELECT name, email, password_hash, status, can_override FROM users WHERE id = $1', [id]);
    expect(rows[0]).toEqual({
      name: `${mark} Renamed`,
      email: `${mark}-renamed@example.com`,
      password_hash: 'new-hash',
      status: 'inactive',
      can_override: true,
    });
    expect(await rolesOf(id)).toEqual([roleB]);
  });

  it('clears every role when sent an empty role list', async () => {
    const id = await makeUser([roleA, roleB]);

    await h.adapter.updateUser(id, { name: `${mark} Still here`, roleIds: [] });

    expect(await rolesOf(id)).toEqual([]);
  });

  it('returns null, and changes nothing, for a user that does not exist', async () => {
    expect(await h.adapter.updateUser(NIL, { name: 'x', roleIds: [roleA] })).toBeNull();
    expect(await rolesOf(NIL)).toEqual([]);
  });

  // BUG: updateUser (PostgresAdapter.ts) always runs
  // `UPDATE users SET ${updates.join(', ')} WHERE ...`. With no scalar field in
  // the patch — e.g. PUT /api/admin/users/:id with body `{ "roleIds": [...] }`,
  // which updateUserSchema accepts — that is `UPDATE users SET  WHERE id = $1`,
  // a syntax error, so the route 500s and the role change is lost. Changing only
  // a user's roles is the ordinary admin action.
  it.fails('changes only the roles when the patch carries nothing else', async () => {
    const id = await makeUser([roleA]);

    await h.adapter.updateUser(id, { roleIds: [roleB] });

    expect(await rolesOf(id)).toEqual([roleB]);
  });
});

describe('updateQuote', () => {
  it('replaces the line items and keeps fields it was not sent', async () => {
    const service = await h.adapter.createService({ name: `${mark} Labour`, category: 'Repair', basePrice: 40 });
    serviceIds.push(String(service.id));
    const quote = await h.adapter.createQuote({
      status: 'draft',
      subtotal: 40,
      taxTotal: 0,
      total: 40,
      notes: 'original',
      items: [{ serviceId: service.id, description: 'One hour', quantity: 1, unitPrice: 40, lineTotal: 40 }],
    });
    quoteIds.push(String(quote.id));

    const updated = await h.adapter.updateQuote(String(quote.id), {
      subtotal: 100,
      total: 100,
      items: [
        { serviceId: service.id, description: 'Two hours', quantity: 2, unitPrice: 40, lineTotal: 80 },
        { serviceId: service.id, description: 'Call-out', quantity: 1, unitPrice: 20, lineTotal: 20 },
      ],
    });

    expect(updated).toMatchObject({ notes: 'original', status: 'draft' });
    expect(Number(updated!.total)).toBe(100);
    const { rows } = await h.query('SELECT description FROM quote_items WHERE quote_id = $1 ORDER BY description', [
      quote.id,
    ]);
    expect(rows.map((r) => r.description)).toEqual(['Call-out', 'Two hours']);
  });

  it('returns null for a quote that does not exist', async () => {
    expect(await h.adapter.updateQuote(NIL, { notes: 'x' })).toBeNull();
  });
});

describe('updateLocation', () => {
  it('updates NOT NULL fields, skips a null for them, and clears nullable ones on null', async () => {
    const loc = await makeLocation('edit');
    await h.adapter.updateLocation(String(loc.id), { address: '1 High St', city: 'Town', state: 'ST', zip: '12345' });

    const updated = await h.adapter.updateLocation(String(loc.id), {
      name: `${mark} Renamed`,
      slug: `${mark}-renamed`,
      timezone: 'America/Chicago',
      status: 'inactive',
      address: null,
      city: null,
      state: 'NS',
      zip: null,
    });
    const nullName = await h.adapter.updateLocation(String(loc.id), { name: null });

    expect(updated).toMatchObject({
      name: `${mark} Renamed`,
      slug: `${mark}-renamed`,
      timezone: 'America/Chicago',
      status: 'inactive',
      address: null,
      city: null,
      state: 'NS',
      zip: null,
    });
    expect(nullName).toMatchObject({ name: `${mark} Renamed` });
  });

  it('refuses a slug another location in the org already uses, but allows keeping its own', async () => {
    await makeLocation('taken');
    const loc = await makeLocation('mine');

    expect(await h.adapter.updateLocation(String(loc.id), { slug: `${mark}-taken` })).toBe('duplicate_slug');
    expect(await h.adapter.updateLocation(String(loc.id), { slug: `${mark}-mine` })).toMatchObject({ id: loc.id });
  });

  it('returns null for a location that does not exist', async () => {
    expect(await h.adapter.updateLocation(NIL, { name: 'x' })).toBeNull();
  });
});

describe('updateRegister', () => {
  it('updates capability flags and clears terminal pairing on null', async () => {
    const loc = await makeLocation('tills');
    const reg = await h.adapter.createRegister({
      org_id: orgId,
      location_id: loc.id,
      name: `${mark} till`,
      register_number: 1,
      display_code: `${mark}-T1`,
    });
    if (typeof reg === 'string') throw new Error(reg);
    registerIds.push(String(reg.id));
    await h.adapter.updateRegister(String(reg.id), { terminal_provider: 'stripe', terminal_device_id: 'tmr_1', placement: 'front' });

    const updated = await h.adapter.updateRegister(String(reg.id), {
      name: `${mark} renamed till`,
      display_code: `${mark}-T1B`,
      type: 'mobile',
      status: 'active',
      idle_lock_seconds: 120,
      has_cash_drawer: false,
      accepts_cash: false,
      can_refund: false,
      can_open_drawer_no_sale: true,
      require_sign_in: false,
      placement: null,
      terminal_provider: null,
      terminal_device_id: null,
    });

    expect(updated).toMatchObject({
      name: `${mark} renamed till`,
      displayCode: `${mark}-T1B`,
      type: 'mobile',
      status: 'active',
      idleLockSeconds: 120,
      hasCashDrawer: false,
      acceptsCash: false,
      canRefund: false,
      canOpenDrawerNoSale: true,
      requireSignIn: false,
      placement: null,
      terminalProvider: null,
      terminalDeviceId: null,
    });
    expect(await h.adapter.updateRegister(String(reg.id), {})).toMatchObject({ id: reg.id, type: 'mobile' });
  });

  it('refuses a display code another register in the org already uses', async () => {
    const loc = await makeLocation('pair');
    const make = async (n: number) => {
      const r = await h.adapter.createRegister({
        org_id: orgId,
        location_id: loc.id,
        name: `${mark} r${n}`,
        register_number: n,
        display_code: `${mark}-P${n}`,
      });
      if (typeof r === 'string') throw new Error(r);
      registerIds.push(String(r.id));
      return r;
    };
    await make(1);
    const second = await make(2);

    expect(await h.adapter.updateRegister(String(second.id), { display_code: `${mark}-P1` })).toBe('duplicate_code');
    expect(await h.adapter.updateRegister(NIL, { name: 'x' })).toBeNull();
  });
});

describe('deleteVariant', () => {
  it('refuses to delete a product’s last variant, deletes one of several, and reports a stranger as not found', async () => {
    const product = await h.adapter.createProduct({
      name: `${mark} Widget`,
      description: mark,
      category: 'Misc',
      basePrice: 3,
    });
    productIds.push(String(product.id));
    await h.query('DELETE FROM product_variants WHERE product_id = $1', [product.id]);
    const { rows } = await h.query(
      'INSERT INTO product_variants (product_id, stock, enabled) VALUES ($1, 1, true) RETURNING id',
      [product.id]
    );
    const firstVariant = String(rows[0].id);

    expect(await h.adapter.deleteVariant(String(product.id), firstVariant)).toBe('last');
    expect(await h.adapter.deleteVariant(String(product.id), NIL)).toBe('not_found');

    const extra = await h.query(
      'INSERT INTO product_variants (product_id, stock, enabled) VALUES ($1, 5, true) RETURNING id',
      [product.id]
    );
    expect(await h.adapter.deleteVariant(String(product.id), NIL)).toBe('not_found');
    expect(await h.adapter.deleteVariant(String(product.id), String(extra.rows[0].id))).toBe('deleted');
  });
});
