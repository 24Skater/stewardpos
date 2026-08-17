import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
} from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import {
  createRegister as createRegisterService,
  disableRegister,
  retireRegister,
} from '../../services/registers';

/**
 * Register API routes.
 *
 * A register is a till: it belongs to a location, is numbered within it,
 * and carries the capabilities that decide what a cashier can do at it
 * (take cash, refund, open the drawer without a sale). See migration 015
 * and `services/registers.ts` for the rules this defers to.
 *
 * Registers are never deleted — see `retire` below — so there is
 * deliberately no DELETE route here.
 */
const router = Router();
router.use(authenticate);

const typeEnum = z.enum(['fixed', 'mobile', 'web', 'kiosk']);
const statusEnum = z.enum(['pending', 'active', 'disabled', 'retired']);

const createSchema = z.object({
  locationId: z.string().trim().min(1, 'A register needs a location'),
  name: z.string().trim().min(1, 'A register needs a name').max(255),
  placement: z.string().max(255).optional().nullable(),
  type: typeEnum.optional(),
  hasCashDrawer: z.boolean().optional(),
  acceptsCash: z.boolean().optional(),
  canRefund: z.boolean().optional(),
  canOpenDrawerNoSale: z.boolean().optional(),
  requireSignIn: z.boolean().optional(),
  idleLockSeconds: z.number().int().positive().optional(),
  // VARCHAR(30) in the schema; not explicitly named in the spec's bounds
  // list, but the same SQLSTATE 22001 risk applies to any string column.
  terminalProvider: z.string().max(30).optional().nullable(),
  terminalDeviceId: z.string().max(255).optional().nullable(),
  /** Override for the auto-derived `<LOCATION-SLUG>-<NN>` code. */
  displayCode: z.string().trim().min(1).max(50).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  placement: z.string().max(255).optional().nullable(),
  type: typeEnum.optional(),
  hasCashDrawer: z.boolean().optional(),
  acceptsCash: z.boolean().optional(),
  canRefund: z.boolean().optional(),
  canOpenDrawerNoSale: z.boolean().optional(),
  requireSignIn: z.boolean().optional(),
  idleLockSeconds: z.number().int().positive().optional(),
  terminalProvider: z.string().max(30).optional().nullable(),
  terminalDeviceId: z.string().max(255).optional().nullable(),
  displayCode: z.string().trim().min(1).max(50).optional(),
});

const listQuerySchema = z.object({
  locationId: z.string().trim().min(1).optional(),
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
 * GET /api/registers[?locationId=&status=]
 */
router.get('/', requirePermission('registers', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const orgId = req.orgId ?? DEFAULT_ORG_ID;

    const registers = await db.getAdapter().getRegisters({
      orgId,
      locationId: query.locationId,
      status: query.status,
    });

    res.json({ success: true, data: registers });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * GET /api/registers/:id
 *
 * Scoped to the caller's org even though `getRegisterById` is not: a bare id
 * lookup would otherwise let one org read another's till configuration —
 * including its terminal device binding — just by guessing or enumerating
 * ids.
 */
router.get('/:id', requirePermission('registers', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const register = await db.getAdapter().getRegisterById(req.params.id);

    if (!register || String(register.orgId) !== orgId) {
      throw new NotFoundError('Register');
    }

    res.json({ success: true, data: register });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/registers
 */
router.post('/', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const adapter = db.getAdapter();

    const result = await createRegisterService(adapter, {
      orgId,
      locationId: body.locationId,
      name: body.name,
      placement: body.placement,
      type: body.type,
      hasCashDrawer: body.hasCashDrawer,
      acceptsCash: body.acceptsCash,
      canRefund: body.canRefund,
      canOpenDrawerNoSale: body.canOpenDrawerNoSale,
      requireSignIn: body.requireSignIn,
      idleLockSeconds: body.idleLockSeconds,
      terminalProvider: body.terminalProvider,
      terminalDeviceId: body.terminalDeviceId,
      displayCode: body.displayCode,
      createdBy: req.user?.id ?? null,
    });

    if (result === 'bad_location') {
      throw new ValidationError('That location does not exist, or does not belong to your organization');
    }
    if (typeof result === 'object' && result !== null && 'limitReached' in result) {
      throw new UnprocessableEntityError(
        `Your organization's register limit of ${result.limitReached} has been reached`
      );
    }
    if (result === 'duplicate_number') {
      throw new ConflictError('That location already has a register with that number');
    }
    if (result === 'duplicate_code') {
      throw new ConflictError('That display code is already in use in your organization');
    }

    logger.info(`Created register ${result.displayCode} (${result.id})`);
    await audit(req, { action: 'create', entity: 'register', entityId: String(result.id), after: result });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * PATCH /api/registers/:id
 */
router.patch('/:id', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const orgId = req.orgId ?? DEFAULT_ORG_ID;

    const existing = await db.getAdapter().getRegisterById(req.params.id);
    if (!existing || String(existing.orgId) !== orgId) {
      throw new NotFoundError('Register');
    }

    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const payload: Record<string, unknown> = {};
    if (has('name')) payload.name = body.name;
    if (has('placement')) payload.placement = body.placement;
    if (has('type')) payload.type = body.type;
    if (has('hasCashDrawer')) payload.has_cash_drawer = body.hasCashDrawer;
    if (has('acceptsCash')) payload.accepts_cash = body.acceptsCash;
    if (has('canRefund')) payload.can_refund = body.canRefund;
    if (has('canOpenDrawerNoSale')) payload.can_open_drawer_no_sale = body.canOpenDrawerNoSale;
    if (has('requireSignIn')) payload.require_sign_in = body.requireSignIn;
    if (has('idleLockSeconds')) payload.idle_lock_seconds = body.idleLockSeconds;
    if (has('terminalProvider')) payload.terminal_provider = body.terminalProvider;
    if (has('terminalDeviceId')) payload.terminal_device_id = body.terminalDeviceId;
    if (has('displayCode')) payload.display_code = body.displayCode?.toUpperCase();

    const result = await db.getAdapter().updateRegister(req.params.id, payload);

    if (result === null) {
      throw new NotFoundError('Register');
    }
    if (result === 'duplicate_code') {
      throw new ConflictError('That display code is already in use in your organization');
    }

    logger.info(`Updated register ${req.params.id}`);
    await audit(req, {
      action: 'update',
      entity: 'register',
      entityId: req.params.id,
      before: existing,
      after: result,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * POST /api/registers/:id/retire
 *
 * Permanent: a retired register's number and display code are never
 * reused. Gated on `delete`, unlike disable/activate, because it is the one
 * status change that cannot be undone.
 */
router.post('/:id/retire', requirePermission('registers', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const existing = await db.getAdapter().getRegisterById(req.params.id);
    if (!existing || String(existing.orgId) !== orgId) {
      throw new NotFoundError('Register');
    }

    const result = await retireRegister(db.getAdapter(), req.params.id);
    if (!result) {
      throw new NotFoundError('Register');
    }

    logger.info(`Retired register ${result.displayCode} (${result.id})`);
    await audit(req, {
      action: 'update',
      entity: 'register',
      entityId: req.params.id,
      before: existing,
      after: result,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/registers/:id/disable
 *
 * Temporary: unlike retiring, a disabled register still occupies a slot
 * against the org's register cap, because the device is expected back.
 */
router.post('/:id/disable', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const existing = await db.getAdapter().getRegisterById(req.params.id);
    if (!existing || String(existing.orgId) !== orgId) {
      throw new NotFoundError('Register');
    }

    const result = await disableRegister(db.getAdapter(), req.params.id);
    if (!result) {
      throw new NotFoundError('Register');
    }

    logger.info(`Disabled register ${result.displayCode} (${result.id})`);
    await audit(req, {
      action: 'update',
      entity: 'register',
      entityId: req.params.id,
      before: existing,
      after: result,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/registers/:id/activate
 * Brings a pending or disabled register back into service.
 */
router.post('/:id/activate', requirePermission('registers', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const existing = await db.getAdapter().getRegisterById(req.params.id);
    if (!existing || String(existing.orgId) !== orgId) {
      throw new NotFoundError('Register');
    }

    const result = await db.getAdapter().setRegisterStatus(req.params.id, 'active');
    if (!result) {
      throw new NotFoundError('Register');
    }

    logger.info(`Activated register ${result.displayCode} (${result.id})`);
    await audit(req, {
      action: 'update',
      entity: 'register',
      entityId: req.params.id,
      before: existing,
      after: result,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
