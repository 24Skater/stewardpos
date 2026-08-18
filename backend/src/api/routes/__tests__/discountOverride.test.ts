import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/**
 * `discount_types.requires_approval` / `approval_threshold` (migration 004)
 * enforced at checkout for the first time — Phase 5. Same mock scaffolding
 * as `orderCheckout.test.ts`, plus the override-grant plumbing.
 */

const getUserByEmail = vi.fn();
const getProductById = vi.fn();
const getSettings = vi.fn();
const createOrder = vi.fn();
const createAuditLog = vi.fn();
const getDiscountTypeById = vi.fn();
const logDiscountUsage = vi.fn();
const incrementPromoCodeUsage = vi.fn();
const getPromoCodeById = vi.fn();
const getAllOrders = vi.fn();
const getOrderById = vi.fn();
const getOrdersByCustomerEmail = vi.fn();
const getRegisterById = vi.fn();
const getRegisters = vi.fn();
const getOpenDrawerSession = vi.fn();
const getOpenShiftForRegister = vi.fn();
const getRegisterOverridesByPrefix = vi.fn();
const consumeRegisterOverride = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getProductById,
      getSettings,
      createOrder,
      createAuditLog,
      getDiscountTypeById,
      getPromoCodeById,
      logDiscountUsage,
      incrementPromoCodeUsage,
      getAllOrders,
      getOrderById,
      getOrdersByCustomerEmail,
      getRegisterById,
      getRegisters,
      getOpenDrawerSession,
      getOpenShiftForRegister,
      getRegisterOverridesByPrefix,
      consumeRegisterOverride,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../../middleware/auth');
const { default: app } = await import('../../../app');

const TEA = {
  id: 'p-tea',
  name: 'Tea',
  basePrice: 100,
  variants: [{ id: 'v1', stock: 100, enabled: true }],
};

const CART = { items: [{ productId: 'p-tea', variantId: 'v1', quantity: 1 }] };

const REGISTER = {
  id: 'reg-1',
  orgId: DEFAULT_ORG_ID,
  displayCode: 'MAIN-01',
  registerNumber: 1,
  hasCashDrawer: true,
  acceptsCash: true,
  canRefund: true,
  status: 'active',
};

/** A quick discount whose type demands approval above a $10 threshold. */
const GATED_DISCOUNT = {
  id: 'dt-big',
  name: 'Manager Special',
  discountType: 'fixed',
  discountValue: 30,
  isActive: true,
  showInPos: true,
  requiresApproval: false,
  approvalThreshold: 10,
};

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const stored = () => createOrder.mock.calls[0][0];

const OVERRIDE_TOKEN = 'ovr_aaaaaaaa_' + 'b'.repeat(32);

function seedValidOverrideGrant(action: string): void {
  getRegisterOverridesByPrefix.mockResolvedValue([
    {
      id: 'ovr-1',
      registerId: 'reg-1',
      action,
      grantHash: bcrypt.hashSync(OVERRIDE_TOKEN, 4),
      expiresAt: Date.now() + 60_000,
      consumedAt: null,
    },
  ]);
  consumeRegisterOverride.mockResolvedValue({
    id: 'ovr-1',
    registerId: 'reg-1',
    approverUserId: 'boss-1',
    action,
    consumedAt: Date.now(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getProductById.mockResolvedValue(TEA);
  getSettings.mockResolvedValue({ taxRateDefault: 0 });
  createAuditLog.mockResolvedValue({});
  logDiscountUsage.mockResolvedValue({});
  incrementPromoCodeUsage.mockResolvedValue(undefined);
  getAllOrders.mockResolvedValue([]);
  getOrderById.mockResolvedValue({ id: 'o1', total: 100, payments: [] });
  getOrdersByCustomerEmail.mockResolvedValue([]);
  getRegisters.mockResolvedValue([REGISTER]);
  getRegisterById.mockResolvedValue(REGISTER);
  getOpenDrawerSession.mockResolvedValue(null);
  getOpenShiftForRegister.mockResolvedValue(null);
  getRegisterOverridesByPrefix.mockResolvedValue([]);
  getDiscountTypeById.mockResolvedValue(GATED_DISCOUNT);
  createOrder.mockImplementation(async (order: Record<string, unknown>) => ({
    id: 'o1',
    createdAt: Date.now(),
    ...order,
  }));
});

describe('discount approval override — POST /api/orders', () => {
  it('refuses checkout with OVERRIDE_REQUIRED when a discount exceeds its approval threshold', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'dt-big' }],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('OVERRIDE_REQUIRED');
    expect(response.body.data.action).toBe('discount_approval');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('succeeds once a valid override grant is supplied', async () => {
    seedValidOverrideGrant('discount_approval');

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Override-Token', OVERRIDE_TOKEN)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'dt-big' }],
      });

    expect(response.status).toBe(201);
    expect(consumeRegisterOverride).toHaveBeenCalled();
    // The approver who granted it is attributed on the order.
    expect(stored().overrideByUserId).toBe('boss-1');
  });

  it('refuses an invalid or already-spent grant with OVERRIDE_REQUIRED', async () => {
    getRegisterOverridesByPrefix.mockResolvedValue([]); // no such grant

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Override-Token', OVERRIDE_TOKEN)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'dt-big' }],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('OVERRIDE_REQUIRED');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('needs no override for a discount under the threshold', async () => {
    getDiscountTypeById.mockResolvedValue({ ...GATED_DISCOUNT, discountValue: 5, approvalThreshold: 10 });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'dt-big' }],
      });

    expect(response.status).toBe(201);
    expect(stored().overrideByUserId).toBeNull();
  });

  it('needs an override when the catalog flags requiresApproval, even under the dollar threshold', async () => {
    getDiscountTypeById.mockResolvedValue({
      ...GATED_DISCOUNT,
      discountValue: 5,
      approvalThreshold: null,
      requiresApproval: true,
    });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        ...CART,
        paymentMethod: 'Cash',
        appliedDiscounts: [{ source: 'quick_discount', id: 'dt-big' }],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('OVERRIDE_REQUIRED');
  });
});
