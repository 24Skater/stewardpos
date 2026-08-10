import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * The adapter methods that had never touched a database.
 *
 * Thirty-four of the adapter's methods were referenced only by route tests that
 * mock them, so their SQL had never executed. Most are list and update queries —
 * unglamorous, but the place where a wrong column name sits silently until
 * someone opens the screen that uses it, which is exactly how `archiveCustomer`
 * stayed broken.
 */
let h: Harness;
const mark = tag();

const created = {
  users: [] as string[],
  roles: [] as string[],
  customers: [] as string[],
  services: [] as string[],
  quotes: [] as string[],
  discounts: [] as string[],
  promos: [] as string[],
  keys: [] as string[],
  orders: [] as string[],
};

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  await h.query('DELETE FROM discount_usage WHERE discount_type_id = ANY($1)', [created.discounts]);
  await h.query('DELETE FROM discount_usage WHERE promo_code_id = ANY($1)', [created.promos]);
  await h.query('DELETE FROM employee_discounts WHERE user_id = ANY($1)', [created.users]).catch(() => {});
  await h.query('DELETE FROM quote_items WHERE quote_id = ANY($1)', [created.quotes]);
  await h.query('DELETE FROM quotes WHERE id = ANY($1)', [created.quotes]);
  for (const id of created.orders) {
    await h.query('DELETE FROM payments WHERE order_id = $1', [id]);
    await h.query('DELETE FROM order_items WHERE order_id = $1', [id]);
    await h.query('DELETE FROM orders WHERE id = $1', [id]);
  }
  await h.query('DELETE FROM api_keys WHERE id = ANY($1)', [created.keys]);
  await h.query('DELETE FROM promo_codes WHERE id = ANY($1)', [created.promos]);
  await h.query('DELETE FROM discount_types WHERE id = ANY($1)', [created.discounts]);
  await h.query('DELETE FROM services WHERE id = ANY($1)', [created.services]);
  await h.query('DELETE FROM customers WHERE id = ANY($1)', [created.customers]);
  await h.query('DELETE FROM user_roles WHERE user_id = ANY($1)', [created.users]);
  await h.query('DELETE FROM user_roles WHERE role_id = ANY($1)', [created.roles]);
  await h.query('DELETE FROM users WHERE id = ANY($1)', [created.users]);
  await h.query('DELETE FROM roles WHERE id = ANY($1)', [created.roles]);
  await h.close();
});

describe('connection', () => {
  it('reports a reachable database', async () => {
    expect(await h.adapter.testConnection()).toBe(true);
  });
});

describe('users and roles', () => {
  it('creates a role, reads it back, and lists it', async () => {
    const role = await h.adapter.createRole({
      name: `${mark} Bench`,
      systemRole: 'standard',
      permissions: { orders: { read: true, write: false, delete: false } },
    });
    created.roles.push(String(role.id));

    expect(await h.adapter.getRoleById(String(role.id))).toMatchObject({ name: `${mark} Bench` });
    expect((await h.adapter.getAllRoles()).map((r) => String(r.id))).toContain(String(role.id));
  });

  it('updates a role’s permissions', async () => {
    const role = await h.adapter.createRole({
      name: `${mark} Editable`,
      systemRole: 'standard',
      permissions: { orders: { read: false, write: false, delete: false } },
    });
    created.roles.push(String(role.id));

    await h.adapter.updateRole(String(role.id), {
      permissions: { orders: { read: true, write: true, delete: false } },
    });

    const after = await h.adapter.getRoleById(String(role.id));
    expect((after.permissions as Record<string, unknown>).orders).toMatchObject({ read: true });
  });

  it('lists users and updates one without blanking the rest', async () => {
    const user = await h.adapter.createUser({
      email: `${mark}-u@example.com`,
      passwordHash: 'not-a-real-hash',
      name: `${mark} Person`,
      status: 'active',
      roleIds: [],
    });
    created.users.push(String(user.id));

    await h.adapter.updateUser(String(user.id), { name: `${mark} Renamed` });

    const all = await h.adapter.getAllUsers();
    const found = all.find((u) => String(u.id) === String(user.id));
    expect(found).toMatchObject({ name: `${mark} Renamed`, email: `${mark}-u@example.com` });
  });

  it('stamps last login without disturbing anything else', async () => {
    const user = await h.adapter.createUser({
      email: `${mark}-login@example.com`,
      passwordHash: 'not-a-real-hash',
      name: `${mark} Login`,
      status: 'active',
      roleIds: [],
    });
    created.users.push(String(user.id));

    await h.adapter.updateUserLastLogin(String(user.id));

    const after = await h.adapter.getUserByEmail(`${mark}-login@example.com`);
    expect(after!.lastLoginAt).toBeTruthy();
    expect(after!.status).toBe('active');
  });

  it('deletes a user', async () => {
    const user = await h.adapter.createUser({
      email: `${mark}-gone@example.com`,
      passwordHash: 'not-a-real-hash',
      name: `${mark} Gone`,
      status: 'active',
      roleIds: [],
    });

    expect(await h.adapter.deleteUser(String(user.id))).toBe(true);
    expect(await h.adapter.getUserByEmail(`${mark}-gone@example.com`)).toBeNull();
  });

  it('deletes a role', async () => {
    const role = await h.adapter.createRole({
      name: `${mark} Temp`,
      systemRole: 'standard',
      permissions: {},
    });

    expect(await h.adapter.deleteRole(String(role.id))).toBe(true);
    expect(await h.adapter.getRoleById(String(role.id))).toBeNull();
  });
});

describe('customers and orders by email', () => {
  it('lists customers and deletes one', async () => {
    const customer = await h.adapter.createCustomer({
      name: `${mark} Buyer`,
      email: `${mark}-buy@example.com`,
    });

    expect((await h.adapter.getAllCustomers()).map((c) => String(c.id))).toContain(
      String(customer.id)
    );
    expect(await h.adapter.deleteCustomer(String(customer.id))).toBe(true);
  });

  it('finds orders by the email they were rung up under', async () => {
    // `orders` has no customer_id — the email snapshot is the only link, which
    // is the fact that broke `archiveCustomer` for years.
    const order = await h.adapter.createOrder({
      items: [],
      subtotal: 5,
      discountTotal: 0,
      taxTotal: 0,
      total: 5,
      paymentMethod: 'Cash',
      customerEmail: `${mark}-orders@example.com`,
      payments: [{ method: 'cash', amount: 5 }],
    });
    created.orders.push(String(order.id));

    const found = await h.adapter.getOrdersByCustomerEmail(`${mark}-orders@example.com`);
    expect(found.map((o) => String(o.id))).toContain(String(order.id));
  });

  it('returns nothing for an email that bought nothing', async () => {
    expect(await h.adapter.getOrdersByCustomerEmail(`${mark}-nobody@example.com`)).toEqual([]);
  });
});

describe('services and quotes lists', () => {
  it('lists services', async () => {
    const service = await h.adapter.createService({
      name: `${mark} Repair`,
      category: `${mark}Bench`,
      basePrice: 10,
    });
    created.services.push(String(service.id));

    expect((await h.adapter.getAllServices()).map((s) => String(s.id))).toContain(
      String(service.id)
    );
  });

  it('lists quotes and updates one', async () => {
    const quote = await h.adapter.createQuote({
      status: 'draft',
      subtotal: 10,
      taxTotal: 0,
      total: 10,
      items: [{ description: `${mark} line`, quantity: 1, unitPrice: 10, lineTotal: 10 }],
    });
    created.quotes.push(String(quote.id));

    await h.adapter.updateQuote(String(quote.id), { notes: `${mark} revised` });

    const all = await h.adapter.getAllQuotes();
    expect(all.map((q) => String(q.id))).toContain(String(quote.id));
    expect((await h.adapter.getQuoteById(String(quote.id))).notes).toBe(`${mark} revised`);
  });
});

describe('discount lists and updates', () => {
  it('lists types, and serves the register a filtered set', async () => {
    const hidden = await h.adapter.createDiscountType({
      name: `${mark} Hidden`,
      discountType: 'percentage',
      discountValue: 5,
      showInPos: false,
      isActive: true,
    });
    created.discounts.push(String(hidden.id));

    const all = await h.adapter.getAllDiscountTypes();
    const forPos = await h.adapter.getDiscountTypesForPOS();

    expect(all.map((d) => String(d.id))).toContain(String(hidden.id));
    // A discount marked not-for-register must not reach a cashier's screen.
    expect(forPos.map((d) => String(d.id))).not.toContain(String(hidden.id));
  });

  it('updates a discount type', async () => {
    const discount = await h.adapter.createDiscountType({
      name: `${mark} Editable`,
      discountType: 'percentage',
      discountValue: 5,
      isActive: true,
    });
    created.discounts.push(String(discount.id));

    await h.adapter.updateDiscountType(String(discount.id), { discountValue: 15 });

    expect((await h.adapter.getDiscountTypeById(String(discount.id))).discountValue).toBe(15);
  });

  it('lists promo codes, finds one by code, and updates it', async () => {
    const promo = await h.adapter.createPromoCode({
      code: `${mark}-P`,
      name: `${mark} Promo`,
      discountType: 'fixed',
      discountValue: 5,
      startsAt: Date.now() - 60_000,
      isActive: true,
    });
    created.promos.push(String(promo.id));

    expect((await h.adapter.getAllPromoCodes()).map((p) => String(p.id))).toContain(
      String(promo.id)
    );
    // Lookup is by the code a customer types, upper-cased on the way in.
    expect(await h.adapter.getPromoCodeByCode(`${mark}-P`.toUpperCase())).toBeTruthy();

    await h.adapter.updatePromoCode(String(promo.id), { discountValue: 8 });
    expect((await h.adapter.getPromoCodeById(String(promo.id))).discountValue).toBe(8);
  });

  it('counts a customer’s use of a promo code', async () => {
    const promo = await h.adapter.createPromoCode({
      code: `${mark}-C`,
      name: `${mark} PerCustomer`,
      discountType: 'fixed',
      discountValue: 5,
      startsAt: Date.now() - 60_000,
      isActive: true,
    });
    created.promos.push(String(promo.id));
    const customer = await h.adapter.createCustomer({
      name: `${mark} Repeat`,
      email: `${mark}-repeat@example.com`,
    });
    created.customers.push(String(customer.id));

    expect(
      await h.adapter.getPromoCodeUsageByCustomer(String(promo.id), String(customer.id))
    ).toBe(0);

    await h.adapter.logDiscountUsage({
      discountSource: 'promo_code',
      promoCodeId: promo.id,
      customerId: customer.id,
      discountName: `${mark} PerCustomer`,
      discountType: 'fixed',
      discountValue: 5,
      discountAmount: 5,
    });

    expect(
      await h.adapter.getPromoCodeUsageByCustomer(String(promo.id), String(customer.id))
    ).toBe(1);
  });

  it('reports usage and stats', async () => {
    expect(Array.isArray(await h.adapter.getDiscountUsage({}))).toBe(true);
    expect(await h.adapter.getDiscountStats({})).toBeTruthy();
  });

  it('deletes a discount type and a promo code', async () => {
    const discount = await h.adapter.createDiscountType({
      name: `${mark} Doomed`,
      discountType: 'fixed',
      discountValue: 1,
      isActive: true,
    });
    const promo = await h.adapter.createPromoCode({
      code: `${mark}-D`,
      name: `${mark} Doomed`,
      discountType: 'fixed',
      discountValue: 1,
      startsAt: Date.now() - 60_000,
      isActive: true,
    });

    expect(await h.adapter.deleteDiscountType(String(discount.id))).toBe(true);
    expect(await h.adapter.deletePromoCode(String(promo.id))).toBe(true);
  });
});

describe('employee discounts', () => {
  it('upserts, reads, lists, and removes one', async () => {
    const user = await h.adapter.createUser({
      email: `${mark}-emp@example.com`,
      passwordHash: 'not-a-real-hash',
      name: `${mark} Employee`,
      status: 'active',
      roleIds: [],
    });
    created.users.push(String(user.id));

    await h.adapter.upsertEmployeeDiscount({ userId: user.id, discountPercentage: 15 });

    expect(await h.adapter.getEmployeeDiscountByUser(String(user.id))).toMatchObject({
      discountPercentage: 15,
    });

    // Upsert, not insert: setting it twice must change the rate rather than
    // create a second row the lookup would then pick between arbitrarily.
    await h.adapter.upsertEmployeeDiscount({ userId: user.id, discountPercentage: 20 });
    expect(await h.adapter.getEmployeeDiscountByUser(String(user.id))).toMatchObject({
      discountPercentage: 20,
    });

    expect(Array.isArray(await h.adapter.getAllEmployeeDiscounts())).toBe(true);
    expect(await h.adapter.deleteEmployeeDiscount(String(user.id))).toBe(true);
  });
});

describe('api key list and update', () => {
  it('lists keys and updates one', async () => {
    const key = await h.adapter.createApiKey({
      name: `${mark} Key`,
      keyPrefix: `sp_${mark}L`,
      keyHash: '$2a$10$abcdefghijklmnopqrstuv',
      scopes: ['read'],
      rateLimit: 1000,
    });
    created.keys.push(String(key.id));

    const all = await h.adapter.getAllApiKeys();
    const found = all.find((k) => String(k.id) === String(key.id));
    expect(found).toBeTruthy();

    // The adapter does return `keyHash`, deliberately — `authenticate` needs it
    // to compare against a presented key. Sanitising is the route's job, and
    // `apiKeyManagement.test.ts` covers that it happens. Asserting it here
    // instead would be testing the wrong layer, which is what my first version
    // of this did; verified against the live API that the HTTP response carries
    // no hash.
    expect(found!.keyHash).toBeTruthy();

    await h.adapter.updateApiKey(String(key.id), { name: `${mark} Renamed` });
    expect((await h.adapter.getApiKeyById(String(key.id))).name).toBe(`${mark} Renamed`);
  });
});
