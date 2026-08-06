import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { repriceOrder, toCents, toDollars, type PriceableProduct } from '../../services/pricing';
import { validateAppliedDiscounts } from '../../services/discountPricing';

const router = Router();

// All order routes require authentication (orders contain sensitive data)
router.use(authenticate);

/**
 * Whether this caller may apply an ad-hoc discount.
 *
 * A manual discount has no catalog entry to validate against, so who may grant
 * one is the only control there is. A cashier holding `orders.write` cannot; an
 * admin, or anyone with `discounts.write`, can.
 */
function grantsManualDiscount(req: AuthRequest): boolean {
  return (req.user?.roles ?? []).some(
    (role) => role.systemRole === 'admin' || role.permissions?.discounts?.write === true
  );
}

/**
 * Order API Routes
 * 
 * GET    /api/orders          - List all orders
 * GET    /api/orders/:id      - Get order by ID
 * POST   /api/orders          - Create new order
 */

// Validation schemas
const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  nameSnapshot: z.string(),
  size: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  color: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  lineDiscount: z.number().min(0).default(0),
  lineTotal: z.number().min(0),
  notes: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
});

/** A discount the register says it applied. Its value is resolved server-side. */
const appliedDiscountSchema = z.object({
  source: z.enum(['quick_discount', 'promo_code', 'manual', 'employee']),
  id: z.string().optional(),
  code: z.string().optional(),
  type: z.enum(['percentage', 'fixed']).optional(),
  value: z.number().optional(),
  reason: z.string().optional(),
});

/**
 * The money fields here are accepted for backward compatibility and then
 * ignored: the server reprices from the catalog.
 *
 * `discountTotal` included. A caller that wants a discount applied must say
 * *which* discounts, via `appliedDiscounts`, so each can be checked against the
 * catalog. A bare `discountTotal` is an unverifiable claim and is now worth
 * nothing.
 */
const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0),
  discountTotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0),
  appliedDiscounts: z.array(appliedDiscountSchema).default([]),
  paymentMethod: z.string(),
  // Customer information is optional - can be omitted, empty string, or valid email
  customerEmail: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().email().optional()
  ),
  customerPhone: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().optional()
  ),
  cardTransactionId: z.string().optional(),
  cardAuthCode: z.string().optional(),
});

/**
 * GET /api/orders
 * List all orders
 */
router.get('/', requirePermission('orders', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const orders = await adapter.getAllOrders();

    logger.info(`Retrieved ${orders.length} orders`);

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/customer/:email
 * Get orders by customer email
 */
router.get('/customer/:email', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params;
    const adapter = db.getAdapter();
    const orders = await adapter.getOrdersByCustomerEmail(email);

    logger.info(`Retrieved ${orders.length} orders for customer: ${email}`);

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/:id
 * Get order by ID
 */
router.get('/:id', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const order = await adapter.getOrderById(id);

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders
 * Create new order
 */
router.post('/', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderData = createOrderSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Reprice from the catalog. Everything the client said about money -
    // unitPrice, lineTotal, subtotal, taxTotal, total - is discarded; only the
    // identifiers and quantities survive. Before this, the API stored whatever
    // totals it was handed, so a shaped request could buy anything for a penny.
    const catalog = new Map<string, PriceableProduct>();
    for (const productId of new Set(orderData.items.map((item) => item.productId))) {
      const product = await adapter.getProductById(productId);
      if (product) catalog.set(productId, product as unknown as PriceableProduct);
    }

    const settings = await adapter.getSettings();
    const taxRate = Number((settings as { taxRateDefault?: number } | null)?.taxRateDefault ?? 0);

    // Price the lines first: a percentage discount needs a subtotal to apply to.
    const lines = repriceOrder(
      orderData.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        notes: item.notes,
      })),
      catalog,
      { taxRate }
    );

    // Then resolve each claimed discount against the catalog. The amount comes
    // from the stored definition; the request only says which one.
    const validated = await validateAppliedDiscounts(orderData.appliedDiscounts, adapter, {
      subtotalCents: toCents(lines.subtotal),
      mayGrantManualDiscount: grantsManualDiscount(req),
    });

    const priced = repriceOrder(
      orderData.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        notes: item.notes,
      })),
      catalog,
      { taxRate, requestedDiscount: toDollars(validated.totalCents) }
    );

    const order = await adapter.createOrder({
      ...orderData,
      ...priced,
    });

    // If this was a card payment, link the terminal transaction to the order
    if (orderData.cardTransactionId) {
      await adapter.updateTerminalTransactionByChargeId(orderData.cardTransactionId, {
        orderId: order.id as string,
        status: 'approved',
        authCode: orderData.cardAuthCode,
      });
    }

    logger.info(`Created order: ${order.id} - Total: $${order.total}`);
    // Orders are immutable, so one create row is the whole story for a sale.
    await audit(req, { action: 'create', entity: 'order', entityId: String(order.id), after: order });

    res.status(201).json({
      success: true,
      data: order,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error('Order validation error:', JSON.stringify(error.errors, null, 2));
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      next(new ValidationError(errorMessage));
    } else {
      next(error);
    }
  }
});

export default router;