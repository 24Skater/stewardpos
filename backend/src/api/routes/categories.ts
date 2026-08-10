import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError, ConflictError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';

/**
 * Category API Routes
 *
 * The `categories` table already existed and was seeded, but nothing could
 * reach it: there was no endpoint, and the admin category field was free text.
 * A shop could therefore only "create" a category by typing it, which meant a
 * typo silently produced a second one that no product would ever share.
 *
 * Categories are inventory data, so they sit under the `inventory` permission
 * rather than a new one — anyone who can edit the catalog can organise it.
 */
const router = Router();

router.use(authenticate);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'A category needs a name')
  .max(255, 'That name is too long');

const createSchema = z.object({
  name: nameSchema,
  icon: z.string().max(50).optional().nullable(),
});

const updateSchema = z.object({
  name: nameSchema,
  icon: z.string().max(50).optional().nullable(),
});

/** Zod errors here are the caller's mistake; without this they surface as 500s. */
function asValidationError(error: unknown): unknown {
  if (error instanceof z.ZodError) {
    return new ValidationError(
      error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    );
  }
  return error;
}

/**
 * GET /api/categories
 * Every category with the number of products in it.
 */
router.get('/', requirePermission('inventory', 'read'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const [categories, unmanaged] = await Promise.all([
      adapter.getAllCategories(),
      // Names products use that no category row defines — a typo or an import
      // can leave a product somewhere the manager cannot see, and so cannot
      // fix. Reported alongside rather than mixed into `data`, since they have
      // no id and nothing here can rename or delete them.
      adapter.getUnmanagedCategories(),
    ]);

    res.json({
      success: true,
      data: categories,
      meta: { total: categories.length, unmanaged },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/categories
 */
router.post('/', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, icon } = createSchema.parse(req.body);
    const category = await db.getAdapter().createCategory(name, icon ?? null);

    if (!category) {
      throw new ConflictError(`There is already a category called "${name}"`);
    }

    logger.info(`Created category ${name}`);
    await audit(req, { action: 'create', entity: 'category', entityId: String(category.id), after: category });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * PUT /api/categories/:id
 * Rename a category — and move its products with it.
 *
 * See the adapter: `products.category` stores the name, so renaming the row on
 * its own would leave every product in it pointing at something that no longer
 * exists. The response reports how many moved.
 */
router.put('/:id', requirePermission('inventory', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, icon } = updateSchema.parse(req.body);
    const result = await db.getAdapter().renameCategory(req.params.id, name, icon);

    if (result === null) {
      throw new NotFoundError('Category not found');
    }
    if (result === 'duplicate') {
      throw new ConflictError(`There is already a category called "${name}"`);
    }

    logger.info(`Renamed category ${req.params.id} to ${name}, moving ${result.productCount} products`);
    await audit(req, { action: 'update', entity: 'category', entityId: req.params.id, after: result });

    res.json({ success: true, data: result });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * DELETE /api/categories/:id[?reassignTo=Name]
 *
 * Refused while products are still in it, because `products.category` is NOT
 * NULL: deleting would leave them naming a category that does not exist, and
 * they would quietly drop out of the category filter. `reassignTo` moves them
 * somewhere real first, which is the only safe way to do it in one step.
 */
router.delete('/:id', requirePermission('inventory', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reassignTo = typeof req.query.reassignTo === 'string' ? req.query.reassignTo : undefined;
    const result = await db.getAdapter().deleteCategory(req.params.id, reassignTo);

    if (result === 'not_found') {
      throw new NotFoundError('Category not found');
    }
    if (result === 'bad_target') {
      throw new ValidationError(`There is no category called "${reassignTo}" to move those products to`);
    }
    if (typeof result === 'object') {
      // The count is in the message because the decision depends on it: moving
      // two products is a different proposition from moving two hundred.
      throw new ConflictError(
        `${result.inUse} product${result.inUse === 1 ? ' is' : 's are'} still in this category. ` +
          'Move them to another category first, or pass reassignTo.'
      );
    }

    logger.info(`Deleted category ${req.params.id}`);
    await audit(req, { action: 'delete', entity: 'category', entityId: req.params.id });

    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
});

export default router;
