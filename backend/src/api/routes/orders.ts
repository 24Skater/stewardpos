import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { repriceOrder, toCents, toDollars, type PriceableProduct } from '../../services/pricing';
import {
  validateAppliedDiscounts,
  type AppliedDiscountRequest,
} from '../../services/discountPricing';

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
  nameSnapshot: z.string().optional(),
  size: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  color: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  quantity: z.number().int().min(1),
  // Accepted and discarded - the server prices the line. Optional because
  // requiring a figure that is then ignored forces every caller to compute
  // something it is not trusted on.
  unitPrice: z.number().min(0).optional(),
  lineDiscount: z.number().min(0).default(0),
  lineTotal: z.number().min(0).optional(),
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
/**
 * What pricing needs, and nothing more.
 *
 * Deliberately not `createOrderSchema.partial()`: a quote has no payment method,
 * no customer, and no totals to ignore, and asking for them would suggest they
 * mattered.
 */
const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.preprocess(
          (val) => (val === null || val === undefined || val === '' ? undefined : val),
          z.string().optional()
        ),
        quantity: z.number().int().min(1),
        notes: z.string().optional(),
      })
    )
    .min(1),
  appliedDiscounts: z.array(appliedDiscountSchema).default([]),
});

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0).optional(),
  discountTotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0).optional(),
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


/** A cart line as both the quote and the create endpoint accept it. */
interface CartLine {
  productId: string;
  variantId?: string;
  quantity: number;
  notes?: string;
}

/**
 * Price a cart authoritatively.
 *
 * The single path shared by `POST /api/orders/quote` and `POST /api/orders`, so
 * the figure the register is quoted is by construction the figure it will be
 * charged. Two implementations would drift, and the failure mode is a customer's
 * card charged one amount while the order records another.
 *
 * Everything the client said about money is discarded here: prices come from the
 * catalog, tax from settings, and each claimed discount is resolved against the
 * discount catalog.
 */
async function priceCart(
  req: AuthRequest,
  items: CartLine[],
  appliedDiscounts: AppliedDiscountRequest[]
) {
  const adapter = db.getAdapter();

  const catalog = new Map<string, PriceableProduct>();
  for (const productId of new Set(items.map((item) => item.productId))) {
    const product = await adapter.getProductById(productId);
    if (product) catalog.set(productId, product as unknown as PriceableProduct);
  }

  const settings = await adapter.getSettings();
  const taxRate = Number((settings as { taxRateDefault?: number } | null)?.taxRateDefault ?? 0);

  const lines = items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    notes: item.notes,
  }));

  // Priced once without discounts first: a percentage discount needs a subtotal
  // to apply to, and that subtotal has to come from the catalog too.
  const undiscounted = repriceOrder(lines, catalog, { taxRate });

  const validated = await validateAppliedDiscounts(appliedDiscounts, adapter, {
    subtotalCents: toCents(undiscounted.subtotal),
    actingUserId: req.user?.id,
    mayGrantManualDiscount: grantsManualDiscount(req),
  });

  return {
    ...repriceOrder(lines, catalog, {
      taxRate,
      requestedDiscount: toDollars(validated.totalCents),
    }),
    appliedDiscounts: validated.discounts,
  };
}

/**
 * POST /api/orders/quote
 * Price a cart without committing to it.
 */
router.post('/quote', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, appliedDiscounts } = quoteSchema.parse(req.body);
    const priced = await priceCart(req, items, appliedDiscounts);

    res.json({ success: true, data: priced });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')));
    } else {
      next(error);
    }
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

    const priced = await priceCart(req, orderData.items, orderData.appliedDiscounts);

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
      logger.error('Order validation error', { issues: error.errors });
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      next(new ValidationError(errorMessage));
    } else {
      next(error);
    }
  }
});

export default router;