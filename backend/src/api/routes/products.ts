import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';

const router = Router();

// Every endpoint requires a session. Reads are not public: a product carries its
// variants, and those carry SKUs and live stock counts, which is inventory data
// a store should not publish. The register is behind a login anyway.
router.use(authenticate);

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
  // Required, because `products.category` is NOT NULL with no default. Marking
  // it optional here meant a request the schema accepted hit a constraint
  // violation and surfaced as a 500 - the caller was told the server broke when
  // it had simply left out a mandatory field.
  category: z
    // Both messages, because Zod uses `required_error` when the field is absent
    // and the `min` message only when it is present but empty. Setting one
    // leaves the other as a bare "Required".
    .string({ required_error: 'A product needs a category' })
    .min(1, 'A product needs a category'),
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
 * List all products
 */
router.get('/', requirePermission('inventory', 'read'), async (_req: Request, res: Response, next: NextFunction) => {
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
 * Get product by ID
 */
router.get('/:id', requirePermission('inventory', 'read'), async (req: Request, res: Response, next: NextFunction) => {
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
 * Create new product
 */
router.post('/', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const productData = createProductSchema.parse(req.body);
    const adapter = db.getAdapter();
    const product = await adapter.createProduct(productData);

    logger.info(`Created product: ${product.name} (${product.id})`);
    await audit(req, { action: 'create', entity: 'product', entityId: String(product.id), after: product });

    res.status(201).json({
      success: true,
      data: product,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(
        new ValidationError(
          error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
        )
      );
    } else {
      next(error);
    }
  }
});

/**
 * PUT /api/products/:id
 * Update product
 */
router.put('/:id', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const productData = updateProductSchema.parse(req.body);
    const adapter = db.getAdapter();
    // Read first so the audit row can show what the values were.
    const before = await adapter.getProductById(id);
    const product = await adapter.updateProduct(id, productData);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    logger.info(`Updated product: ${id}`);
    await audit(req, { action: 'update', entity: 'product', entityId: id, before, after: product });

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(
        new ValidationError(
          error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
        )
      );
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/products/:id
 * Delete product
 */
router.delete('/:id', requirePermission('inventory', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const before = await adapter.getProductById(id);
    const deleted = await adapter.deleteProduct(id);

    if (!deleted) {
      throw new NotFoundError('Product not found');
    }

    logger.info(`Deleted product: ${id}`);
    await audit(req, { action: 'delete', entity: 'product', entityId: id, before });

    res.json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;