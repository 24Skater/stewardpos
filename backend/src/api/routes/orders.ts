import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All order routes require authentication (orders contain sensitive data)

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

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0),
  discountTotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0),
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
});

/**
 * GET /api/orders
 * List all orders
 */
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
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
 * GET /api/orders/:id
 * Get order by ID
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderData = createOrderSchema.parse(req.body);
    const adapter = db.getAdapter();
    const order = await adapter.createOrder(orderData);

    logger.info(`Created order: ${order.id} - Total: $${order.total}`);

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