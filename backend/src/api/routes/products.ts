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
const listQuerySchema = z.object({
  /** Matches name, product barcode, and variant SKU/barcode, case-insensitively. */
  q: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get('/', requirePermission('inventory', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const adapter = db.getAdapter();
    const { products, total } = await adapter.getAllProducts(query);

    logger.info(`Retrieved ${products.length} of ${total} products`);

    // `meta` is always present; `data` stays a bare array so every existing
    // caller is unaffected. Paging is opt-in via `limit` precisely because a
    // silent default would drop products off the end of the register.
    res.json({
      success: true,
      data: products,
      meta: { total, limit: query.limit, offset: query.offset },
    });
  } catch (error) {
    // A bad `limit` or `offset` is the caller's mistake. Passing the ZodError
    // straight to `next` made it an unclassified 500.
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
 * GET /api/products/barcode/:code
 * Resolve a scanned barcode to a product and the specific variant it names.
 *
 * The register currently filters its loaded catalog client-side, which works
 * only while the whole catalog fits in the page. This resolves server-side, and
 * — unlike a client-side scan — says *which* variant matched, so scanning the
 * large size adds the large size rather than whatever came first.
 *
 * Declared before `/:id` so a scan is not mistaken for a product id.
 */
router.get('/barcode/:code', requirePermission('inventory', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const { products } = await db.getAdapter().getAllProducts({ q: code });

    // The search is a substring match; a scan has to be exact, or scanning
    // `123` would resolve to a product barcoded `1234`.
    for (const product of products) {
      const variants = (product.variants as Array<Record<string, unknown>>) ?? [];
      const variant = variants.find((candidate) => candidate.barcode === code);

      if (variant) {
        return res.json({ success: true, data: { product, variant } });
      }
      if (product.barcode === code) {
        return res.json({ success: true, data: { product, variant: variants[0] ?? null } });
      }
    }

    throw new NotFoundError('Nothing found with that barcode');
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

/**
 * Variant sub-resources.
 *
 * `POST /api/products` accepts nested variants but `PUT` accepts none, so a
 * product's options were fixed at creation — a shop could not add a size or
 * correct a stock count without recreating the product, and CSV re-import had to
 * skip variant rows on anything already in the catalog.
 */

const createVariantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  priceOverride: z.number().min(0).optional(),
  priceDelta: z.number().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

const updateVariantSchema = createVariantSchema.partial();

/**
 * POST /api/products/:id/variants
 */
router.post('/:id/variants', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = createVariantSchema.parse(req.body);
    const variant = await db.getAdapter().createVariant(id, data);

    if (!variant) {
      throw new NotFoundError('Product not found');
    }

    logger.info(`Added variant ${variant.id} to product ${id}`);
    await audit(req, {
      action: 'update',
      entity: 'product',
      entityId: id,
      after: { addedVariant: variant },
    });

    res.status(201).json({ success: true, data: variant });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')));
    } else {
      next(error);
    }
  }
});

/**
 * PUT /api/products/:id/variants/:variantId
 */
router.put('/:id/variants/:variantId', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, variantId } = req.params;
    const data = updateVariantSchema.parse(req.body);
    const variant = await db.getAdapter().updateVariant(id, variantId, data);

    if (!variant) {
      throw new NotFoundError('Variant not found on that product');
    }

    logger.info(`Updated variant ${variantId}`);
    await audit(req, {
      action: 'update',
      entity: 'product',
      entityId: id,
      after: { updatedVariant: variant },
    });

    res.json({ success: true, data: variant });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/products/:id/variants/:variantId
 */
router.delete('/:id/variants/:variantId', requirePermission('inventory', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, variantId } = req.params;
    const outcome = await db.getAdapter().deleteVariant(id, variantId);

    if (outcome === 'not_found') {
      throw new NotFoundError('Variant not found on that product');
    }
    if (outcome === 'last') {
      // A product with no variants cannot be sold, and there is no separate
      // "unsellable" state, so removing the last one would strand it.
      throw new ValidationError(
        'A product needs at least one variant. Disable it instead of removing it.'
      );
    }

    logger.info(`Deleted variant ${variantId} from product ${id}`);
    await audit(req, { action: 'update', entity: 'product', entityId: id, before: { removedVariant: variantId } });

    res.json({ success: true, message: 'Variant deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;