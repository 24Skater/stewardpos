import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All customer routes require authentication
router.use(authenticate);

/**
 * Customer API Routes
 * 
 * GET    /api/customers          - List all customers
 * POST   /api/customers          - Create new customer
 */

// Validation schemas
const createCustomerSchema = z.object({
  name: z.string().min(1),
  org: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/customers
 * List all customers
 */
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const customers = await adapter.getAllCustomers();

    logger.info(`Retrieved ${customers.length} customers`);

    res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/customers
 * Create new customer
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const customerData = createCustomerSchema.parse(req.body);
    const adapter = db.getAdapter();
    const customer = await adapter.createCustomer(customerData);

    logger.info(`Created customer: ${customer.name} (${customer.id})`);

    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

export default router;