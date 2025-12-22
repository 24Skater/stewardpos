import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// GET endpoints are public (for browsing products)
// Write operations (POST, PUT, DELETE) require authentication

/**
 * Product/Inventory API Routes
 * 
 * GET    /api/products          - List all products
 * GET    /api/products/:id      - Get product by ID
 * POST   /api/products          - Create new product
 * PUT    /api/products/:id      - Update product
 * DELETE /api/products/:id      - Delete product
 */

// Validation schemas
const variantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  priceOverride: z.number().optional(),
  priceDelta: z.number().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  basePrice: z.number().min(0),
  image: z.string().optional(),
  barcode: z.string().optional(),
  variants: z.array(variantSchema).optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  basePrice: z.number().min(0).optional(),
  image: z.string().optional(),
  barcode: z.string().optional(),
});

/**
 * GET /api/products
 * List all products (public - no auth required)
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const products = await adapter.getAllProducts();

    logger.info(`Retrieved ${products.length} products`);

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id
 * Get product by ID (public - no auth required)
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const product = await adapter.getProductById(id);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products
 * Create new product (requires authentication)
 */
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const productData = createProductSchema.parse(req.body);
    const adapter = db.getAdapter();
    const product = await adapter.createProduct(productData);

    logger.info(`Created product: ${product.name} (${product.id})`);

    res.status(201).json({
      success: true,
      data: product,
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
 * PUT /api/products/:id
 * Update product (requires authentication)
 */
router.put('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const productData = updateProductSchema.parse(req.body);
    const adapter = db.getAdapter();
    const product = await adapter.updateProduct(id, productData);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    logger.info(`Updated product: ${id}`);

    res.json({
      success: true,
      data: product,
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
 * DELETE /api/products/:id
 * Delete product (requires authentication)
 */
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteProduct(id);

    if (!deleted) {
      throw new NotFoundError('Product not found');
    }

    logger.info(`Deleted product: ${id}`);

    res.json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;