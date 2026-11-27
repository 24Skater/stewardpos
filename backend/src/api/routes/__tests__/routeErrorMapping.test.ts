import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * How the routes turn adapter outcomes into HTTP: a lookup that finds nothing
 * is a 404, and a database failure is a 500 that does not echo the driver's
 * message to the client.
 *
 * The feature suites each cover their happy paths and validation; what they
 * mostly skip is the `catch → next(error)` and "not found" arms, which is
 * where a route that swallows an error, or reports a missing row as success,
 * would hide. One table here rather than a 404 and a 500 test bolted onto
 * every file.
 *
 * The adapter is a Proxy: every method is a `vi.fn`, so a row in the table
 * only names the one method whose outcome it is testing.
 */
const fns = new Map<string, ReturnType<typeof vi.fn>>();
const fn = (name: string) => {
  if (!fns.has(name)) fns.set(name, vi.fn());
  return fns.get(name)!;
};

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () =>
      new Proxy(
        {},
        { get: (_target, name) => (typeof name === 'string' && name !== 'then' ? fn(name) : undefined) }
      ),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');
const { PERMISSION_RESOURCES } = await import('../../middleware/authorize');

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  status: 'active',
  roleIds: ['r1'],
  roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
};

const auth = () => ({
  Authorization: `Bearer ${jwt.sign({ id: 'u1', email: ADMIN.email, roleIds: ['r1'] }, config.jwt.secret, { expiresIn: '1h' })}`,
});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Row {
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  /** The adapter call whose outcome decides the response. */
  adapterMethod: string;
  /** Other adapter calls the route makes first, answered so it reaches the one under test. */
  arrange?: Record<string, unknown>;
}

const FULL_PERMISSIONS = Object.fromEntries(
  PERMISSION_RESOURCES.map((r) => [r, { read: true, write: true, delete: true }])
);

const send = (row: Row) => {
  for (const [name, value] of Object.entries(row.arrange ?? {})) fn(name).mockResolvedValue(value);
  const req = request(app)[row.method](row.path).set(auth());
  return row.body ? req.send(row.body) : req;
};

/** Endpoints where the adapter returning null/false must become a 404. */
const NOT_FOUND: Row[] = [
  { method: 'get', path: '/api/discounts/types/d1', adapterMethod: 'getDiscountTypeById' },
  { method: 'delete', path: '/api/discounts/types/d1', adapterMethod: 'deleteDiscountType' },
  { method: 'get', path: '/api/discounts/promos/p1', adapterMethod: 'getPromoCodeById' },
  { method: 'put', path: '/api/discounts/promos/p1', body: { name: 'x' }, adapterMethod: 'updatePromoCode' },
  { method: 'delete', path: '/api/discounts/promos/p1', adapterMethod: 'deletePromoCode' },
  { method: 'delete', path: '/api/discounts/employee/u2', adapterMethod: 'deleteEmployeeDiscount' },
  { method: 'put', path: '/api/services/s1', body: { basePrice: 5 }, adapterMethod: 'updateService' },
  { method: 'delete', path: '/api/services/s1', adapterMethod: 'deleteService' },
  { method: 'put', path: '/api/admin/users/u2/pin', body: { pin: '482913' }, adapterMethod: 'getUserById' },
  { method: 'put', path: '/api/admin/roles/r9', body: { name: 'Lead' }, adapterMethod: 'updateRole' },
  { method: 'delete', path: '/api/admin/roles/r9', adapterMethod: 'deleteRole' },
  { method: 'put', path: '/api/admin/api-keys/k1', body: { name: 'x' }, adapterMethod: 'updateApiKey' },
  { method: 'get', path: '/api/products/p1', adapterMethod: 'getProductById' },
  { method: 'put', path: '/api/products/p1', body: { name: 'x' }, adapterMethod: 'updateProduct' },
  { method: 'delete', path: '/api/products/p1', adapterMethod: 'deleteProduct' },
  { method: 'post', path: '/api/customers/c1/archive', body: {}, adapterMethod: 'getCustomerById' },
  { method: 'post', path: '/api/customers/c1/archive', body: {}, adapterMethod: 'archiveCustomer', arrange: { getCustomerById: { id: 'c1', name: 'Ann' } } },
  { method: 'delete', path: '/api/customers/c1/permanent', adapterMethod: 'getCustomerById' },
  { method: 'delete', path: '/api/customers/c1/permanent', adapterMethod: 'permanentDeleteCustomer', arrange: { getCustomerById: { id: 'c1', name: 'Ann' } } },
];

/** Endpoints whose adapter failure must surface as a 500. */
const FAILS: Row[] = [
  { method: 'get', path: '/api/discounts/types', adapterMethod: 'getAllDiscountTypes' },
  { method: 'get', path: '/api/discounts/types/pos', adapterMethod: 'getDiscountTypesForPOS' },
  { method: 'get', path: '/api/discounts/types/d1', adapterMethod: 'getDiscountTypeById' },
  {
    method: 'post',
    path: '/api/discounts/types',
    body: { name: 'Senior', discountType: 'percentage', discountValue: 10 },
    adapterMethod: 'createDiscountType',
  },
  { method: 'put', path: '/api/discounts/types/d1', body: { discountValue: 5 }, adapterMethod: 'updateDiscountType' },
  { method: 'delete', path: '/api/discounts/types/d1', adapterMethod: 'deleteDiscountType' },
  { method: 'get', path: '/api/discounts/promos', adapterMethod: 'getAllPromoCodes' },
  { method: 'get', path: '/api/discounts/promos/p1', adapterMethod: 'getPromoCodeById' },
  {
    method: 'post',
    path: '/api/discounts/promos',
    body: { code: 'X', name: 'X', discountType: 'fixed', discountValue: 1, startsAt: new Date().toISOString() },
    adapterMethod: 'createPromoCode',
  },
  { method: 'put', path: '/api/discounts/promos/p1', body: { name: 'x' }, adapterMethod: 'updatePromoCode' },
  { method: 'delete', path: '/api/discounts/promos/p1', adapterMethod: 'deletePromoCode' },
  {
    method: 'post',
    path: '/api/discounts/promos/validate',
    body: { code: 'X', cartTotal: 10, itemCount: 1 },
    adapterMethod: 'getPromoCodeByCode',
  },
  { method: 'post', path: '/api/discounts/promos/p1/use', adapterMethod: 'incrementPromoCodeUsage' },
  { method: 'get', path: '/api/discounts/employee', adapterMethod: 'getAllEmployeeDiscounts' },
  { method: 'get', path: '/api/discounts/employee/u2', adapterMethod: 'getEmployeeDiscountByUser' },
  { method: 'post', path: '/api/discounts/employee', body: { userId: 'u2' }, adapterMethod: 'upsertEmployeeDiscount' },
  { method: 'delete', path: '/api/discounts/employee/u2', adapterMethod: 'deleteEmployeeDiscount' },
  { method: 'get', path: '/api/discounts/usage', adapterMethod: 'getDiscountUsage' },
  {
    method: 'post',
    path: '/api/discounts/usage',
    body: { discountSource: 'manual', discountAmount: 1 },
    adapterMethod: 'logDiscountUsage',
  },
  { method: 'get', path: '/api/discounts/stats', adapterMethod: 'getDiscountStats' },
  { method: 'get', path: '/api/services', adapterMethod: 'getAllServices' },
  { method: 'get', path: '/api/services/s1', adapterMethod: 'getServiceById' },
  { method: 'post', path: '/api/services', body: { name: 'Fix', category: 'Repair' }, adapterMethod: 'createService' },
  { method: 'put', path: '/api/services/s1', body: { basePrice: 5 }, adapterMethod: 'updateService' },
  { method: 'delete', path: '/api/services/s1', adapterMethod: 'deleteService' },
  { method: 'get', path: '/api/admin/users', adapterMethod: 'getAllUsers' },
  { method: 'get', path: '/api/admin/roles', adapterMethod: 'getAllRoles' },
  { method: 'post', path: '/api/admin/roles', body: { name: 'Lead', permissions: FULL_PERMISSIONS }, adapterMethod: 'createRole' },
  { method: 'put', path: '/api/admin/roles/r9', body: { name: 'Lead' }, adapterMethod: 'updateRole' },
  { method: 'delete', path: '/api/admin/roles/r9', adapterMethod: 'deleteRole' },
  { method: 'get', path: '/api/admin/settings', adapterMethod: 'getSettings' },
  { method: 'put', path: '/api/admin/users/u2/pin', body: { pin: '482913' }, adapterMethod: 'getUserById' },
  { method: 'get', path: '/api/admin/api-keys', adapterMethod: 'getAllApiKeys' },
  { method: 'post', path: '/api/admin/api-keys', body: { name: 'CI' }, adapterMethod: 'createApiKey' },
  { method: 'put', path: '/api/admin/api-keys/k1', body: { name: 'x' }, adapterMethod: 'updateApiKey' },
  { method: 'get', path: '/api/products', adapterMethod: 'getAllProducts' },
  { method: 'put', path: '/api/products/p1', body: { name: 'x' }, adapterMethod: 'updateProduct' },
  { method: 'delete', path: '/api/products/p1', adapterMethod: 'deleteProduct' },
  { method: 'get', path: '/api/customers', adapterMethod: 'getAllCustomers' },
  { method: 'post', path: '/api/customers', body: { name: 'Ann' }, adapterMethod: 'createCustomer' },
  { method: 'post', path: '/api/customers/c1/archive', body: {}, adapterMethod: 'archiveCustomer', arrange: { getCustomerById: { id: 'c1', name: 'Ann' } } },
  { method: 'delete', path: '/api/customers/c1/permanent', adapterMethod: 'permanentDeleteCustomer', arrange: { getCustomerById: { id: 'c1', name: 'Ann' } } },
  { method: 'get', path: '/api/orders', adapterMethod: 'getAllOrders' },
  { method: 'get', path: '/api/orders/customer/a@b.c', adapterMethod: 'getOrdersByCustomerEmail' },
  { method: 'get', path: '/api/receipts', adapterMethod: 'getAllOrders' },
  { method: 'get', path: '/api/receipts/search?query=tea', adapterMethod: 'searchOrders' },
  { method: 'get', path: '/api/receipts/o1/history', adapterMethod: 'getReceiptEmailHistory' },
  { method: 'post', path: '/api/receipts/o1/start-return', adapterMethod: 'getOrderById' },
];

const originalEnv = config.nodeEnv;

beforeEach(() => {
  fns.clear();
  fn('getUserByEmail').mockResolvedValue(ADMIN);
  fn('createAuditLog').mockResolvedValue({});
  config.nodeEnv = 'test';
});

afterEach(() => {
  config.nodeEnv = originalEnv;
});

describe('a lookup that finds nothing', () => {
  it.each(NOT_FOUND)('$method $path → 404 when $adapterMethod finds nothing', async (row) => {
    fn(row.adapterMethod).mockResolvedValue(null);

    const response = await send(row);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});

describe('a database failure', () => {
  it.each(FAILS)('$method $path → 500 when $adapterMethod throws', async (row) => {
    fn(row.adapterMethod).mockRejectedValue(new Error('relation "secret_table" does not exist'));

    const response = await send(row);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('secret_table');
  });
});

describe('validation on update', () => {
  it.each([
    ['put', '/api/discounts/types/d1', { discountValue: -1 }, 'updateDiscountType'],
    ['put', '/api/discounts/promos/p1', { maxUses: 0 }, 'updatePromoCode'],
    ['put', '/api/services/s1', { unitType: 'weekly' }, 'updateService'],
    ['post', '/api/discounts/promos/validate', { code: '', cartTotal: 1, itemCount: 1 }, 'getPromoCodeByCode'],
    ['post', '/api/discounts/usage', { discountSource: 'bribe', discountAmount: 1 }, 'logDiscountUsage'],
    ['put', '/api/customers/c1', { email: 'not-an-email' }, 'updateCustomer'],
    ['post', '/api/customers/c1/archive', { reason: 42 }, 'archiveCustomer'],
    ['put', '/api/admin/api-keys/k1', { scopes: ['root'] }, 'updateApiKey'],
    ['put', '/api/admin/roles/r9', { systemRole: 'owner' }, 'updateRole'],
    ['put', '/api/products/p1/variants/v1', { stock: -1 }, 'updateVariant'],
    ['post', '/api/orders/quote', { items: [] }, 'getProductById'],
  ] as const)('%s %s rejects a bad body with 400 before touching the database', async (method, path, body, adapterMethod) => {
    const response = await send({ method, path, body, adapterMethod });

    expect(response.status).toBe(400);
    expect(fn(adapterMethod)).not.toHaveBeenCalled();
  });
});

describe('promo validation edge rules', () => {
  const promo = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    code: 'VIP',
    name: 'VIP',
    isActive: true,
    startsAt: 0,
    expiresAt: null,
    maxUses: null,
    currentUses: 0,
    maxUsesPerCustomer: null,
    firstOrderOnly: false,
    minPurchase: 0,
    minItems: 0,
    specificCustomers: [],
    discountType: 'percentage',
    discountValue: 10,
    ...over,
  });
  const validate = (body: Record<string, unknown>) =>
    send({ method: 'post', path: '/api/discounts/promos/validate', body, adapterMethod: 'getPromoCodeByCode' });

  it('refuses a customer-restricted code to a customer not on the list', async () => {
    fn('getPromoCodeByCode').mockResolvedValue(promo({ specificCustomers: ['c-vip'] }));

    const response = await validate({ code: 'vip', cartTotal: 50, itemCount: 1, customerId: 'c-other' });

    expect(response.body).toMatchObject({ success: false, valid: false });
  });

  it('accepts it for a customer on the list', async () => {
    fn('getPromoCodeByCode').mockResolvedValue(promo({ specificCustomers: ['c-vip'] }));

    const response = await validate({ code: 'vip', cartTotal: 50, itemCount: 1, customerId: 'c-vip' });

    expect(response.body.data).toMatchObject({ valid: true, promo: { discountAmount: 5 } });
  });

  it('prices a non-monetary promo type at zero rather than guessing', async () => {
    fn('getPromoCodeByCode').mockResolvedValue(promo({ discountType: 'free_shipping', discountValue: 99 }));

    const response = await validate({ code: 'vip', cartTotal: 50, itemCount: 1 });

    expect(response.body.data.promo.discountAmount).toBe(0);
  });

  it('lets a customer under their per-customer limit through', async () => {
    fn('getPromoCodeByCode').mockResolvedValue(promo({ maxUsesPerCustomer: 2 }));
    fn('getPromoCodeUsageByCustomer').mockResolvedValue(1);

    const response = await validate({ code: 'vip', cartTotal: 50, itemCount: 1, customerId: 'c1' });

    expect(fn('getPromoCodeUsageByCustomer')).toHaveBeenCalledWith('p1', 'c1');
    expect(response.body.data.valid).toBe(true);
  });
});

describe('deleting a customer who still has history', () => {
  it.each([
    ['customers_quotes_fkey', 'quotes'],
    ['orders_customer_id_fkey', 'orders'],
    ['returns_customer_id_fkey', 'returns'],
    ['something_else_fkey', 'records'],
  ])('maps a foreign-key violation on %s to a 400 naming the %s', async (constraint, relatedTable) => {
    fn('deleteCustomer').mockRejectedValue(
      Object.assign(new Error('violates foreign key constraint'), { code: '23503', constraint })
    );

    const response = await send({ method: 'delete', path: '/api/customers/c1', adapterMethod: 'deleteCustomer' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, hasRelatedRecords: true, relatedTable });
    expect(response.body.error).toContain('Use Archive or Permanent Delete');
  });

  it('archives a customer and audits who it was', async () => {
    fn('getCustomerById').mockResolvedValue({ id: 'c1', name: 'Ann' });
    fn('archiveCustomer').mockResolvedValue(true);

    const response = await send({
      method: 'post',
      path: '/api/customers/c1/archive',
      body: { reason: 'moved' },
      adapterMethod: 'archiveCustomer',
    });

    expect(response.status).toBe(200);
    expect(fn('archiveCustomer')).toHaveBeenCalledWith('c1', 'u1', 'moved');
    expect(fn('createAuditLog')).toHaveBeenCalledWith(expect.objectContaining({ action: 'archive', entityId: 'c1' }));
  });

  it('permanently deletes one and says whose records went', async () => {
    fn('getCustomerById').mockResolvedValue({ id: 'c1', name: 'Ann' });
    fn('permanentDeleteCustomer').mockResolvedValue(true);

    const response = await send({
      method: 'delete',
      path: '/api/customers/c1/permanent',
      adapterMethod: 'permanentDeleteCustomer',
    });

    expect(response.body.message).toContain('"Ann"');
  });
});

describe('API key updates', () => {
  it('never returns the key hash', async () => {
    fn('updateApiKey').mockResolvedValue({ id: 'k1', name: 'CI', keyHash: '$2b$secret' });

    const response = await send({
      method: 'put',
      path: '/api/admin/api-keys/k1',
      body: { isActive: false },
      adapterMethod: 'updateApiKey',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 'k1', name: 'CI' });
    expect(fn('updateApiKey')).toHaveBeenCalledWith('k1', { isActive: false });
  });
});

describe('role changes', () => {
  it('audits a role update with what it was before and after', async () => {
    fn('getRoleById').mockResolvedValue({ id: 'r9', name: 'Old' });
    fn('updateRole').mockResolvedValue({ id: 'r9', name: 'Lead' });

    const response = await send({
      method: 'put',
      path: '/api/admin/roles/r9',
      body: { name: 'Lead' },
      adapterMethod: 'updateRole',
    });

    expect(response.body.data).toEqual({ id: 'r9', name: 'Lead' });
    expect(fn('createAuditLog')).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', entity: 'role', entityId: 'r9' })
    );
    const logged = JSON.stringify(fn('createAuditLog').mock.calls[0][0]);
    expect(logged).toContain('Old');
    expect(logged).toContain('Lead');
  });

  it('audits a role deletion with what was removed', async () => {
    fn('getRoleById').mockResolvedValue({ id: 'r9', name: 'Old' });
    fn('deleteRole').mockResolvedValue(true);

    const response = await send({ method: 'delete', path: '/api/admin/roles/r9', adapterMethod: 'deleteRole' });

    expect(response.status).toBe(200);
    expect(JSON.stringify(fn('createAuditLog').mock.calls[0][0])).toContain('Old');
  });

  it('lists users for the admin screen', async () => {
    fn('getAllUsers').mockResolvedValue([{ id: 'u2' }]);

    const response = await send({ method: 'get', path: '/api/admin/users', adapterMethod: 'getAllUsers' });

    expect(response.body.data).toEqual([{ id: 'u2' }]);
  });
});
