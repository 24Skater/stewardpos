import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError, ServiceUnavailableError } from '../../utils/errors';
import { sendEmail } from '../../services/email';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All receipt routes require authentication
router.use(authenticate);

/**
 * Receipts API Routes
 * 
 * GET    /api/receipts              - List all receipts (orders)
 * GET    /api/receipts/:id          - Get receipt by order ID
 * GET    /api/receipts/search       - Search receipts
 * POST   /api/receipts/:id/resend   - Resend receipt email
 * GET    /api/receipts/:id/history  - Get resend history
 */

// Validation schemas
/**
 * The plain-text receipt a customer receives.
 *
 * Text rather than HTML: a receipt is a list of lines and a total, it has to
 * survive every mail client, and an HTML one is a second thing to keep in step
 * with the printed version for no gain.
 */
function renderReceiptText(
  order: Record<string, unknown>,
  subject: string,
  includeItems: boolean
): string {
  const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
  const lines = [subject, new Date(Number(order.createdAt)).toLocaleString(), ''];

  if (includeItems) {
    for (const item of (order.items as Array<Record<string, unknown>>) ?? []) {
      // `nameSnapshot` and `lineTotal` are the real field names - guessing at
      // `productName`/`total` rendered every line as "1 x Item  $0.00".
      //
      // The snapshot is also the correct field on principle: it is the name as
      // sold, so renaming a product later cannot rewrite a receipt already
      // issued for it.
      const variant = [item.size, item.color].filter(Boolean).join(' ');
      const name = `${item.nameSnapshot ?? 'Item'}${variant ? ` (${variant})` : ''}`;
      lines.push(`${item.quantity} x ${name}  ${money(item.lineTotal)}`);
    }
    lines.push('');
  }

  lines.push(`Subtotal  ${money(order.subtotal)}`);
  // Only when there was one - a "Discount $0.00" line invites the question of
  // which discount, and there wasn't one.
  if (Number(order.discountTotal ?? 0) > 0) lines.push(`Discount  -${money(order.discountTotal)}`);
  lines.push(`Tax       ${money(order.taxTotal)}`);
  lines.push(`Total     ${money(order.total)}`);
  if (order.paymentMethod) lines.push(`Paid by   ${order.paymentMethod}`);

  return lines.join('\n');
}

const resendReceiptSchema = z.object({
  email: z.string().email(),
  includeItems: z.boolean().default(true),
});

const searchReceiptsSchema = z.object({
  query: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  customerEmail: z.string().optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  paymentMethod: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/**
 * GET /api/receipts
 * List all receipts (orders) with pagination
 */
router.get('/', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const orders = await adapter.getAllOrders();
    
    // Apply pagination
    const paginatedOrders = orders.slice(offset, offset + limit);

    // Enhance with return info
    const receiptsWithReturns = await Promise.all(
      paginatedOrders.map(async (order) => {
        const returns = await adapter.getReturnsByOrder(order.id);
        const hasReturns = returns.length > 0;
        const totalReturned = returns.reduce((sum, r) => sum + r.total, 0);
        
        return {
          ...order,
          hasReturns,
          returnCount: returns.length,
          totalReturned,
          netTotal: order.total - totalReturned,
        };
      })
    );

    res.json({
      success: true,
      data: receiptsWithReturns,
      pagination: {
        total: orders.length,
        limit,
        offset,
        hasMore: offset + limit < orders.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts/search
 * Search receipts with filters
 */
router.get('/search', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = searchReceiptsSchema.parse(req.query);
    const adapter = db.getAdapter();

    const orders = await adapter.searchOrders({
      query: params.query,
      startDate: params.startDate ? parseInt(params.startDate) : undefined,
      endDate: params.endDate ? parseInt(params.endDate) : undefined,
      customerEmail: params.customerEmail,
      minAmount: params.minAmount ? parseFloat(params.minAmount) : undefined,
      maxAmount: params.maxAmount ? parseFloat(params.maxAmount) : undefined,
      paymentMethod: params.paymentMethod,
      limit: params.limit ? parseInt(params.limit) : 50,
      offset: params.offset ? parseInt(params.offset) : 0,
    });

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * GET /api/receipts/:id
 * Get full receipt details by order ID
 */
router.get('/:id', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();

    const order = await adapter.getOrderById(id);
    if (!order) {
      throw new NotFoundError('Receipt not found');
    }

    // Get any returns for this order
    const returns = await adapter.getReturnsByOrder(id);

    // Get receipt email history
    const emailHistory = await adapter.getReceiptEmailHistory(id);

    res.json({
      success: true,
      data: {
        ...order,
        returns,
        emailHistory,
        canReturn: returns.length === 0 || returns.every(r => r.status === 'rejected'),
        netTotal: order.total - returns.reduce((sum, r) => r.status === 'completed' ? sum + r.total : sum, 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/receipts/:id/resend
 * Resend receipt to email
 */
router.post('/:id/resend', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = resendReceiptSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Get the order
    const order = await adapter.getOrderById(id);
    if (!order) {
      throw new NotFoundError('Receipt not found');
    }

    const receiptContent = {
      orderId: order.id,
      createdAt: order.createdAt,
      items: order.items,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      total: order.total,
      paymentMethod: order.paymentMethod,
      customerEmail: order.customerEmail,
    };

    const subject = `Receipt #${id.slice(0, 8).toUpperCase()}`;

    // This used to log `status: 'sent'` and reply "Receipt sent to ..." without
    // anything being sent. A shop reading its own resend history would see a
    // customer had been emailed when they had not - the worst kind of wrong,
    // because it looks like evidence.
    const result = await sendEmail({
      to: data.email,
      subject,
      text: renderReceiptText(order, subject, data.includeItems),
    });

    // Recorded whatever the outcome, including failures: a resend that did not
    // arrive is exactly what someone reads this history to find out.
    await adapter.logReceiptEmail({
      orderId: id,
      recipientEmail: data.email,
      subject,
      receiptType: 'sale',
      // The actual outcome, including `logged`. Recording a log-only send as
      // `failed` is its own lie: it shows a bounce to someone reading the
      // history to find out whether their customer got the receipt.
      status: result.status,
      sentBy: req.user?.id,
    });

    if (result.status === 'failed') {
      logger.warn(`Receipt for order ${id} could not be emailed to ${data.email}: ${result.detail}`);
      throw new ServiceUnavailableError(`The receipt could not be sent: ${result.detail}`);
    }

    logger.info(`Receipt for order ${id} to ${data.email}: ${result.status}`);

    res.json({
      success: true,
      // The message reflects what actually happened. With no mail adapter
      // configured the default is `console`, and claiming delivery there is the
      // bug this replaces.
      message:
        result.status === 'sent'
          ? `Receipt sent to ${data.email}`
          : `No email adapter is configured, so the receipt for ${data.email} was written to the server log instead`,
      data: {
        sentTo: data.email,
        status: result.status,
        detail: result.detail,
        receiptContent,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * GET /api/receipts/:id/history
 * Get receipt email send history
 */
router.get('/:id/history', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();

    const history = await adapter.getReceiptEmailHistory(id);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/receipts/:id/start-return
 * Helper endpoint to start a return from a receipt
 */
router.post('/:id/start-return', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();

    // Get the order with items
    const order = await adapter.getOrderById(id);
    if (!order) {
      throw new NotFoundError('Receipt not found');
    }

    // Check if order has already been fully returned
    const existingReturns = await adapter.getReturnsByOrder(id);
    const completedReturns = existingReturns.filter(r => r.status === 'completed');
    
    // Calculate what's already been returned
    const returnedItems: Record<string, number> = {};
    for (const ret of completedReturns) {
      if (ret.items) {
        for (const item of ret.items) {
          const key = item.originalOrderItemId || item.productId;
          returnedItems[key] = (returnedItems[key] || 0) + item.returnQuantity;
        }
      }
    }

    // Build returnable items
    const returnableItems = (order.items || []).map((item: Record<string, unknown>) => {
      const key = String(item.id || item.productId);
      const alreadyReturned = returnedItems[key] || 0;
      const returnableQty = Number(item.quantity ?? 0) - alreadyReturned;
      
      return {
        originalOrderItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        nameSnapshot: item.nameSnapshot,
        size: item.size,
        color: item.color,
        originalQuantity: item.quantity,
        alreadyReturned,
        returnableQuantity: Math.max(0, returnableQty),
        unitPrice: item.unitPrice,
        canReturn: returnableQty > 0,
      };
    });

    res.json({
      success: true,
      data: {
        order: {
          id: order.id,
          createdAt: order.createdAt,
          total: order.total,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          paymentMethod: order.paymentMethod,
        },
        returnableItems,
        hasReturnableItems: returnableItems.some((i: Record<string, unknown>) => (i.canReturn as boolean) === true),
        existingReturns: existingReturns.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

