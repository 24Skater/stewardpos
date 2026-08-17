import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError, ConflictError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { slugify } from '../../services/registers';

/**
 * Location API routes.
 *
 * A location is a physical site — an address, a timezone — that registers
 * belong to; see migration 015. Locations sit under the `registers`
 * permission rather than getting one of their own: naming and organising
 * sites is part of managing the register estate, not a separate concern.
 */
const router = Router();
router.use(authenticate);

const statusEnum = z.enum(['active', 'retired']);

const createSchema = z.object({
  name: z.string().trim().min(1, 'A location needs a name').max(255),
  // Auto-derived from `name` via `slugify` when omitted, so a manager naming
  // a second site does not also have to invent a URL-safe identifier.
  slug: z.string().trim().min(1).max(255).optional(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  timezone: z.string().max(100).optional(),
  status: statusEnum.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().min(1).max(255).optional(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  timezone: z.string().max(100).optional(),
  status: statusEnum.optional(),
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
 * GET /api/locations
 * Every location for the caller's org, each carrying its non-retired
 * register count.
 */
router.get('/', requirePermission('registers', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const locations = await db.getAdapter().getLocations(orgId);

    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/locations/:id
 *
 * Scoped to the caller's org even though `getLocationById` is not: a bare id
 * lookup would otherwise let one org read another's site address, city, and
 * timezone just by guessing or enumerating ids.
 */
router.get('/:id', requirePermission('registers', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const location = await db.getAdapter().getLocationById(req.params.id);

    if (!location || String(location.orgId) !== orgId) {
      throw new NotFoundError('Location');
    }

    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/locations
 */
router.post('/', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const slug = body.slug ?? slugify(body.name);

    if (!slug) {
      throw new ValidationError('Could not derive a URL-safe slug from that name; provide one explicitly');
    }

    const result = await db.getAdapter().createLocation({
      org_id: orgId,
      name: body.name,
      slug,
      address: body.address ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      timezone: body.timezone,
      status: body.status,
    });

    if (result === 'duplicate_slug') {
      throw new ConflictError(`A location with the slug "${slug}" already exists`);
    }

    logger.info(`Created location ${result.name} (${result.id})`);
    await audit(req, { action: 'create', entity: 'location', entityId: String(result.id), after: result });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * PATCH /api/locations/:id
 */
router.patch('/:id', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const orgId = req.orgId ?? DEFAULT_ORG_ID;

    const existing = await db.getAdapter().getLocationById(req.params.id);
    if (!existing || String(existing.orgId) !== orgId) {
      throw new NotFoundError('Location');
    }

    // Built with explicit presence checks, not a plain spread: the adapter
    // distinguishes "the caller sent null to clear this field" from "the
    // caller didn't send this field at all", and a payload without a key
    // preserves that distinction.
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const payload: Record<string, unknown> = {};
    if (has('name')) payload.name = body.name;
    if (has('slug')) payload.slug = body.slug;
    if (has('address')) payload.address = body.address;
    if (has('city')) payload.city = body.city;
    if (has('state')) payload.state = body.state;
    if (has('zip')) payload.zip = body.zip;
    if (has('timezone')) payload.timezone = body.timezone;
    if (has('status')) payload.status = body.status;

    const result = await db.getAdapter().updateLocation(req.params.id, payload);

    if (result === null) {
      throw new NotFoundError('Location');
    }
    if (result === 'duplicate_slug') {
      throw new ConflictError(`A location with the slug "${String(payload.slug)}" already exists`);
    }

    logger.info(`Updated location ${req.params.id}`);
    await audit(req, {
      action: 'update',
      entity: 'location',
      entityId: req.params.id,
      before: existing,
      after: result,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(asValidationError(error));
  }
});

export default router;
