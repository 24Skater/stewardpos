import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize, requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError, getErrorMessage, errorProps } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';

const router = Router();

// All customer routes require authentication
router.use(authenticate);

/**
 * Customer API Routes
 * 
 * GET    /api/customers              - List all customers
 * GET    /api/customers/:id          - Get customer by ID
 * POST   /api/customers              - Create new customer
 * PUT    /api/customers/:id          - Update customer
 * DELETE /api/customers/:id          - Delete customer (soft delete check)
 * POST   /api/customers/:id/archive  - Archive customer (moves to archive table)
 * DELETE /api/customers/:id/permanent - Permanently delete customer (admin only)
 */

// Validation schemas
const createCustomerSchema = z.object({
  name: z.string().min(1),
  org: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const updateCustomerSchema = createCustomerSchema.partial();

/**
 * GET /api/customers
 * List all customers
 */
router.get('/', requirePermission('customers', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
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
 * GET /api/customers/:id
 * Get customer by ID
 */
router.get('/:id', requirePermission('customers', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const customer = await adapter.getCustomerById(id);

    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/customers
 * Create new customer
 */
router.post('/', requirePermission('customers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const customerData = createCustomerSchema.parse(req.body);
    const adapter = db.getAdapter();
    const customer = await adapter.createCustomer(customerData);

    logger.info(`Created customer: ${customer.name} (${customer.id})`);
    await audit(req, { action: 'create', entity: 'customer', entityId: String(customer.id), after: customer });

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

/**
 * PUT /api/customers/:id
 * Update customer
 */
router.put('/:id', requirePermission('customers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const customerData = updateCustomerSchema.parse(req.body);
    const adapter = db.getAdapter();
    const customer = await adapter.updateCustomer(id, customerData);

    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    logger.info(`Updated customer: ${id}`);
    await audit(req, { action: 'update', entity: 'customer', entityId: id, after: customer });

    res.json({
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

/**
 * DELETE /api/customers/:id
 * Delete customer (will fail if customer has related records)
 */
router.delete('/:id', requirePermission('customers', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteCustomer(id);

    if (!deleted) {
      throw new NotFoundError('Customer not found');
    }

    logger.info(`Deleted customer: ${id}`);
    await audit(req, { action: 'delete', entity: 'customer', entityId: id });

    res.json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error: unknown) {
    // Handle foreign key constraint violations with a user-friendly message
    if (errorProps(error).code === '23503' || getErrorMessage(error)?.includes('foreign key constraint')) {
      const constraint = String(errorProps(error).constraint || '');
      let relatedTable = 'records';
      
      if (constraint.includes('quotes')) {
        relatedTable = 'quotes';
      } else if (constraint.includes('orders')) {
        relatedTable = 'orders';
      } else if (constraint.includes('returns')) {
        relatedTable = 'returns';
      }
      
      return res.status(400).json({
        success: false,
        error: `Cannot delete customer because they have associated ${relatedTable}. Use Archive or Permanent Delete instead.`,
        hasRelatedRecords: true,
        relatedTable,
      });
    }
    next(error);
  }
});

// Validation schema for archive
const archiveCustomerSchema = z.object({
  reason: z.string().optional(),
});

/**
 * POST /api/customers/:id/archive
 * Archive customer and their related records (quotes, orders)
 * Moves data to archive tables for potential restoration later
 */
router.post('/:id/archive', requirePermission('customers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = archiveCustomerSchema.parse(req.body);
    const adapter = db.getAdapter();
    
    // Get customer first to include name in response
    const customer = await adapter.getCustomerById(id);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const archived = await adapter.archiveCustomer(id, req.user!.id, reason);

    if (!archived) {
      throw new NotFoundError('Customer not found');
    }

    logger.info(`Archived customer: ${customer.name} (${id}) by user ${req.user!.id}`);
    await audit(req, { action: 'archive', entity: 'customer', entityId: id, before: customer });

    res.json({
      success: true,
      message: `Customer "${customer.name}" has been archived along with their quotes and orders.`,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/customers/:id/permanent
 * Permanently delete customer and ALL related records
 * Admin only - this action cannot be undone
 */
router.delete(
  '/:id/permanent',
  authorize(['admin']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const adapter = db.getAdapter();
      
      // Get customer first to include name in response
      const customer = await adapter.getCustomerById(id);
      if (!customer) {
        throw new NotFoundError('Customer not found');
      }

      const deleted = await adapter.permanentDeleteCustomer(id);

      if (!deleted) {
        throw new NotFoundError('Customer not found');
      }

      logger.warn(`PERMANENT DELETE: Customer ${customer.name} (${id}) and all related records deleted by admin ${req.user!.id}`);

      res.json({
        success: true,
        message: `Customer "${customer.name}" and all related records have been permanently deleted.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
