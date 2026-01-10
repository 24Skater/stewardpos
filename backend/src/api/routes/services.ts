import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

/**
 * Service API Routes
 * 
 * GET    /api/services          - List all services
 * GET    /api/services/:id      - Get service by ID
 * POST   /api/services          - Create new service (requires auth)
 * PUT    /api/services/:id      - Update service (requires auth)
 * DELETE /api/services/:id      - Delete service (requires auth)
 */

// Validation schemas
const createServiceSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  basePrice: z.number().min(0).optional(),
  unitType: z.enum(['flat', 'hourly', 'daily', 'per_item']).default('flat'),
  isActive: z.boolean().default(true),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  description: z.string().optional(),
  basePrice: z.number().min(0).optional(),
  unitType: z.enum(['flat', 'hourly', 'daily', 'per_item']).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/services
 * List all services (public)
 */
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const services = await adapter.getAllServices();

    logger.info(`Retrieved ${services.length} services`);

    res.json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/services/:id
 * Get service by ID
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const service = await adapter.getServiceById(id);

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    res.json({
      success: true,
      data: service,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/services
 * Create new service (requires authentication)
 */
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const serviceData = createServiceSchema.parse(req.body);
    const adapter = db.getAdapter();
    const service = await adapter.createService(serviceData);

    logger.info(`Created service: ${service.name} (${service.id})`);

    res.status(201).json({
      success: true,
      data: service,
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
 * PUT /api/services/:id
 * Update service (requires authentication)
 */
router.put('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const serviceData = updateServiceSchema.parse(req.body);
    const adapter = db.getAdapter();
    const service = await adapter.updateService(id, serviceData);

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    logger.info(`Updated service: ${id}`);

    res.json({
      success: true,
      data: service,
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
 * DELETE /api/services/:id
 * Delete service (requires authentication)
 */
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteService(id);

    if (!deleted) {
      throw new NotFoundError('Service not found');
    }

    logger.info(`Deleted service: ${id}`);

    res.json({
      success: true,
      message: 'Service deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
