import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
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
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.get('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.post('/:id/resend', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = resendReceiptSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Get the order
    const order = await adapter.getOrderById(id);
    if (!order) {
      throw new NotFoundError('Receipt not found');
    }

    // In production, this would send an actual email
    // For now, we log the receipt email and track it
    
    // Log the email send
    await adapter.logReceiptEmail({
      orderId: id,
      recipientEmail: data.email,
      subject: `Receipt #${id.slice(0, 8).toUpperCase()}`,
      receiptType: 'sale',
      status: 'sent',
      sentBy: req.user?.id,
    });

    logger.info(`Resent receipt for order ${id} to ${data.email}`);

    // Build receipt content for response
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

    res.json({
      success: true,
      message: `Receipt sent to ${data.email}`,
      data: {
        sentTo: data.email,
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
router.get('/:id/history', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.post('/:id/start-return', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    const returnableItems = (order.items || []).map((item: any) => {
      const key = item.id || item.productId;
      const alreadyReturned = returnedItems[key] || 0;
      const returnableQty = item.quantity - alreadyReturned;
      
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
        hasReturnableItems: returnableItems.some((i: any) => i.canReturn),
        existingReturns: existingReturns.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

