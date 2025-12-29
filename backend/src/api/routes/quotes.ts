import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All quote routes require authentication
router.use(authenticate);

/**
 * Quote (Service Order) API Routes
 * 
 * GET    /api/quotes              - List all quotes
 * GET    /api/quotes/:id          - Get quote by ID
 * GET    /api/quotes/customer/:id - Get quotes by customer
 * POST   /api/quotes              - Create new quote
 * PUT    /api/quotes/:id          - Update quote
 * PUT    /api/quotes/:id/status   - Update quote status
 * DELETE /api/quotes/:id          - Delete quote
 */

// Validation schemas
const quoteItemSchema = z.object({
  serviceId: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().min(0.01),
  unitPrice: z.number().min(0),
  lineTotal: z.number().min(0),
});

const createQuoteSchema = z.object({
  customerId: z.string().optional(),
  items: z.array(quoteItemSchema).min(1),
  subtotal: z.number().min(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0),
  notes: z.string().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'completed', 'cancelled']).default('draft'),
  expiresAt: z.number().optional(),
});

const updateQuoteSchema = createQuoteSchema.partial();

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'completed', 'cancelled']),
});

/**
 * GET /api/quotes
 * List all quotes
 */
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const quotes = await adapter.getAllQuotes();

    logger.info(`Retrieved ${quotes.length} quotes`);

    res.json({
      success: true,
      data: quotes,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/quotes/customer/:customerId
 * Get quotes by customer ID
 */
router.get('/customer/:customerId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId } = req.params;
    const adapter = db.getAdapter();
    const quotes = await adapter.getQuotesByCustomer(customerId);

    res.json({
      success: true,
      data: quotes,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/quotes/:id
 * Get quote by ID
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const quote = await adapter.getQuoteById(id);

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    res.json({
      success: true,
      data: quote,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/quotes
 * Create new quote (service order)
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const quoteData = createQuoteSchema.parse(req.body);
    const adapter = db.getAdapter();
    const quote = await adapter.createQuote(quoteData);

    logger.info(`Created quote: ${quote.id}`);

    res.status(201).json({
      success: true,
      data: quote,
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
 * PUT /api/quotes/:id
 * Update quote
 */
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const quoteData = updateQuoteSchema.parse(req.body);
    const adapter = db.getAdapter();
    const quote = await adapter.updateQuote(id, quoteData);

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    logger.info(`Updated quote: ${id}`);

    res.json({
      success: true,
      data: quote,
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
 * PUT /api/quotes/:id/status
 * Update quote status
 */
router.put('/:id/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = updateStatusSchema.parse(req.body);
    const adapter = db.getAdapter();
    const quote = await adapter.updateQuoteStatus(id, status);

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    logger.info(`Updated quote ${id} status to: ${status}`);

    res.json({
      success: true,
      data: quote,
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
 * DELETE /api/quotes/:id
 * Delete quote
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteQuote(id);

    if (!deleted) {
      throw new NotFoundError('Quote not found');
    }

    logger.info(`Deleted quote: ${id}`);

    res.json({
      success: true,
      message: 'Quote deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;

