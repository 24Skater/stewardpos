import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All return routes require authentication
router.use(authenticate);

/**
 * Returns & Refunds API Routes
 * 
 * GET    /api/returns              - List all returns
 * GET    /api/returns/:id          - Get return by ID
 * GET    /api/returns/order/:id    - Get returns for an order
 * GET    /api/returns/customer/:id - Get returns for a customer
 * POST   /api/returns              - Create a return
 * PUT    /api/returns/:id          - Update return
 * PUT    /api/returns/:id/status   - Update return status
 * POST   /api/returns/:id/process-refund - Process refund
 * POST   /api/returns/:id/restock  - Restock items
 */

// Helper to preprocess null/empty values to undefined
const nullToUndefined = (val: unknown) => (val === null || val === undefined || val === '' ? undefined : val);

// Validation schemas
const returnItemSchema = z.object({
  originalOrderItemId: z.preprocess(nullToUndefined, z.string().optional()),
  productId: z.string(),
  variantId: z.preprocess(nullToUndefined, z.string().optional()),
  nameSnapshot: z.string(),
  size: z.preprocess(nullToUndefined, z.string().optional()),
  color: z.preprocess(nullToUndefined, z.string().optional()),
  originalQuantity: z.number().int().min(1),
  returnQuantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  lineTotal: z.number().min(0),
  condition: z.enum(['good', 'damaged', 'defective', 'opened']).default('good'),
  notes: z.preprocess(nullToUndefined, z.string().optional()),
});

const createReturnSchema = z.object({
  originalOrderId: z.string(),
  returnType: z.enum(['return', 'exchange', 'void']).default('return'),
  customerEmail: z.preprocess(nullToUndefined, z.string().email().optional()),
  customerPhone: z.preprocess(nullToUndefined, z.string().optional()),
  customerId: z.preprocess(nullToUndefined, z.string().optional()),
  items: z.array(returnItemSchema).min(1),
  subtotal: z.number().min(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0),
  refundMethod: z.preprocess(nullToUndefined, z.enum(['original_payment', 'store_credit', 'cash', 'card']).optional()),
  reasonCode: z.preprocess(nullToUndefined, z.enum(['defective', 'wrong_item', 'not_needed', 'damaged', 'other']).optional()),
  reasonDetails: z.preprocess(nullToUndefined, z.string().optional()),
  internalNotes: z.preprocess(nullToUndefined, z.string().optional()),
  restockItems: z.boolean().default(true),
  restockingFee: z.number().min(0).default(0),
});

const updateReturnStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'completed', 'rejected']),
  internalNotes: z.string().optional(),
});

const processRefundSchema = z.object({
  refundMethod: z.enum(['original_payment', 'store_credit', 'cash', 'card']),
  amount: z.number().min(0).optional(), // Partial refund amount
  notes: z.string().optional(),
});

// Generate unique return number
function generateReturnNumber(): string {
  const date = new Date();
  const prefix = 'RET';
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}

// Generate store credit code
function generateStoreCreditCode(): string {
  return 'SC-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

/**
 * GET /api/returns
 * List all returns with optional filters
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const { status, startDate, endDate, customerId } = req.query;
    
    const returns = await adapter.getAllReturns({
      status: status as string,
      startDate: startDate ? parseInt(startDate as string) : undefined,
      endDate: endDate ? parseInt(endDate as string) : undefined,
      customerId: customerId as string,
    });

    res.json({
      success: true,
      data: returns,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/returns/stats
 * Get return statistics for reporting
 */
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const { startDate, endDate } = req.query;
    
    const stats = await adapter.getReturnStats({
      startDate: startDate ? parseInt(startDate as string) : undefined,
      endDate: endDate ? parseInt(endDate as string) : undefined,
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/returns/order/:orderId
 * Get returns for a specific order
 */
router.get('/order/:orderId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const adapter = db.getAdapter();
    const returns = await adapter.getReturnsByOrder(orderId);

    res.json({
      success: true,
      data: returns,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/returns/customer/:customerId
 * Get returns for a specific customer
 */
router.get('/customer/:customerId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId } = req.params;
    const adapter = db.getAdapter();
    const returns = await adapter.getReturnsByCustomer(customerId);

    res.json({
      success: true,
      data: returns,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/returns/:id
 * Get return by ID with items
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const returnData = await adapter.getReturnById(id);

    if (!returnData) {
      throw new NotFoundError('Return not found');
    }

    res.json({
      success: true,
      data: returnData,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/returns
 * Create a new return
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createReturnSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Verify the original order exists
    const originalOrder = await adapter.getOrderById(data.originalOrderId);
    if (!originalOrder) {
      throw new NotFoundError('Original order not found');
    }

    // Generate return number
    const returnNumber = generateReturnNumber();

    // Create the return
    const returnData = await adapter.createReturn({
      ...data,
      returnNumber,
      status: 'pending',
      refundStatus: 'pending',
      createdBy: req.user?.id,
    });

    logger.info(`Created return: ${returnNumber} for order ${data.originalOrderId}`);

    res.status(201).json({
      success: true,
      data: returnData,
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
 * PUT /api/returns/:id/status
 * Update return status (approve/reject/complete)
 */
router.put('/:id/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = updateReturnStatusSchema.parse(req.body);
    const adapter = db.getAdapter();

    const returnData = await adapter.updateReturnStatus(id, {
      status: data.status,
      internalNotes: data.internalNotes,
      approvedBy: data.status === 'approved' ? req.user?.id : undefined,
    });

    if (!returnData) {
      throw new NotFoundError('Return not found');
    }

    logger.info(`Updated return ${id} status to: ${data.status}`);

    res.json({
      success: true,
      data: returnData,
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
 * POST /api/returns/:id/process-refund
 * Process refund for a return
 */
router.post('/:id/process-refund', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = processRefundSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Get the return
    const returnData = await adapter.getReturnById(id);
    if (!returnData) {
      throw new NotFoundError('Return not found');
    }

    // Check if return is approved
    if (returnData.status !== 'approved' && returnData.status !== 'completed') {
      throw new ValidationError('Return must be approved before processing refund');
    }

    // Check if already refunded
    if (returnData.refundStatus === 'processed') {
      throw new ValidationError('Refund already processed for this return');
    }

    const refundAmount = data.amount || returnData.total;

    // Process based on refund method
    let storeCreditCode = null;
    if (data.refundMethod === 'store_credit') {
      storeCreditCode = generateStoreCreditCode();
      // Create store credit
      await adapter.createStoreCredit({
        customerId: returnData.customerId,
        customerEmail: returnData.customerEmail,
        returnId: id,
        code: storeCreditCode,
        originalAmount: refundAmount,
        remainingAmount: refundAmount,
        status: 'active',
        expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
      });
    }

    // Create refund transaction record
    const refundTransaction = await adapter.createRefundTransaction({
      returnId: id,
      orderId: returnData.originalOrderId,
      transactionType: data.amount && data.amount < returnData.total ? 'partial_refund' : 'full_refund',
      amount: refundAmount,
      paymentMethod: data.refundMethod,
      status: 'completed',
      processedBy: req.user?.id,
    });

    // Update return refund status
    await adapter.updateReturnRefundStatus(id, {
      refundStatus: 'processed',
      refundMethod: data.refundMethod,
      refundProcessedAt: Date.now(),
      storeCreditCode,
      storeCreditAmount: data.refundMethod === 'store_credit' ? refundAmount : 0,
    });

    logger.info(`Processed refund for return ${id}: $${refundAmount} via ${data.refundMethod}`);

    res.json({
      success: true,
      data: {
        refundTransaction,
        storeCreditCode,
        amount: refundAmount,
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
 * POST /api/returns/:id/restock
 * Restock items from a return
 */
router.post('/:id/restock', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { itemIds } = req.body; // Optional: specific items to restock
    const adapter = db.getAdapter();

    // Get the return with items
    const returnData = await adapter.getReturnById(id);
    if (!returnData) {
      throw new NotFoundError('Return not found');
    }

    // Restock items
    const restockedItems = await adapter.restockReturnItems(id, itemIds);

    logger.info(`Restocked ${restockedItems.length} items from return ${id}`);

    res.json({
      success: true,
      data: {
        restockedCount: restockedItems.length,
        items: restockedItems,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

