import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import {
  requireRegisterToken,
  requireMatchingRegister,
  AuthenticatedRegisterRequest,
} from '../middleware/registerAuth';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  AuthenticationError,
} from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import {
  createRegister as createRegisterService,
  disableRegister,
  retireRegister,
  withLiveness,
} from '../../services/registers';
import {
  issuePairingCode,
  redeemPairingCode,
  revokeCredential,
} from '../../services/registerEnrolment';

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
 *
 * Two routes below are deliberately registered BEFORE `router.use(authenticate)`
 * and so run without a user session at all:
 *
 * - `POST /pair` — the device has no session to present yet; that's the
 *   whole problem enrolment solves. Rate-limited instead, in `app.ts`.
 * - `POST /:id/heartbeat` — authenticated by `X-Register-Token`
 *   (`requireRegisterToken`/`requireMatchingRegister` in
 *   `middleware/registerAuth.ts`), a device credential, not a user one.
 *
 * Everything else needs `authenticate` to run first, same as before.
 */
const router = Router();

const pairSchema = z.object({
  code: z.string().trim().min(1, 'A pairing code is required'),
});

/**
 * POST /api/registers/pair
 *
 * Redeem a pairing code for a device token. No session, on purpose — see
 * the note above the router. Rate limited by `pairLimiter` in `app.ts`,
 * mounted on this exact path ahead of this router.
 */
router.post('/pair', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = pairSchema.parse(req.body);
    const result = await redeemPairingCode(db.getAdapter(), code);

    if (result === 'unknown') {
      throw new AuthenticationError('That pairing code is not valid');
    }
    if (result === 'expired') {
      throw new AuthenticationError('That pairing code has expired');
    }
    if (result === 'already_redeemed') {
      throw new AuthenticationError('That pairing code has already been used');
    }
    if (result === 'retired') {
      throw new UnprocessableEntityError('That register has been retired');
    }

    logger.info(`Register ${result.register.displayCode} (${result.register.id}) paired`);
    // No req.user — this endpoint has no session — but a credential going
    // live is exactly what an audit log is for, even with no human actor to
    // attribute it to yet; `audit()` records a null userId in that case.
    await audit(req, {
      action: 'create',
      entity: 'register_credential',
      entityId: String(result.register.id),
      after: { registerId: result.register.id, enrolled: true },
    });

    res.status(201).json({
      success: true,
      data: { token: result.token, register: withLiveness(result.register) },
      message: 'Save this token now — it will not be shown again.',
    });
  } catch (error) {
    next(asValidationError(error));
  }
});

/**
 * POST /api/registers/:id/heartbeat
 *
 * Cheap by design — a device is expected to call this roughly once a
 * minute. Authenticated by `X-Register-Token`, not a user session.
 */
router.post(
  '/:id/heartbeat',
  requireRegisterToken,
  requireMatchingRegister,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const updated = await db.getAdapter().touchRegisterLastSeen(req.params.id);
      if (!updated) {
        throw new NotFoundError('Register');
      }
      res.json({ success: true, data: withLiveness(updated) });
    } catch (error) {
      next(error);
    }
  }
);

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

    res.json({ success: true, data: registers.map((register) => withLiveness(register)) });
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

    res.json({ success: true, data: withLiveness(register) });
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

/**
 * POST /api/registers/:id/pairing-code
 *
 * Mints a fresh pairing code for a register — see `services/registerEnrolment.ts`
 * for what issuing one does to any credential the register already has.
 */
router.post(
  '/:id/pairing-code',
  requirePermission('registers', 'write'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.orgId ?? DEFAULT_ORG_ID;
      const existing = await db.getAdapter().getRegisterById(req.params.id);
      if (!existing || String(existing.orgId) !== orgId) {
        throw new NotFoundError('Register');
      }

      const result = await issuePairingCode(db.getAdapter(), req.params.id, req.user?.id ?? null);
      if (result === 'not_found') {
        throw new NotFoundError('Register');
      }
      if (result === 'retired') {
        throw new UnprocessableEntityError('A retired register cannot be paired');
      }

      logger.info(`Pairing code issued for register ${existing.displayCode} (${req.params.id})`);
      await audit(req, {
        action: 'create',
        entity: 'register_credential',
        entityId: req.params.id,
        after: { registerId: req.params.id, expiresAt: result.expiresAt },
      });

      res.status(201).json({
        success: true,
        data: {
          code: result.code,
          formattedCode: result.formattedCode,
          expiresAt: result.expiresAt,
          registerId: result.registerId,
        },
        message: 'Save this code now — it will not be shown again.',
      });
    } catch (error) {
      next(asValidationError(error));
    }
  }
);

const revokeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  force: z.boolean().optional(),
});

/**
 * POST /api/registers/:id/revoke
 *
 * Destroys a register's credential and returns it to `pending` — the whole
 * point of Phase 3: unlike `disable`, there is no way back into service
 * without re-enrolling. Refused (409) when the register has an open drawer
 * session, unless `force: true`, which closes that session at its expected
 * cash first rather than orphaning it. See `services/registerEnrolment.ts`.
 */
router.post(
  '/:id/revoke',
  requirePermission('registers', 'delete'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = revokeSchema.parse(req.body ?? {});
      const orgId = req.orgId ?? DEFAULT_ORG_ID;
      const adapter = db.getAdapter();

      const existing = await adapter.getRegisterById(req.params.id);
      if (!existing || String(existing.orgId) !== orgId) {
        throw new NotFoundError('Register');
      }

      const openSession = await adapter.getOpenDrawerSession(req.params.id);
      if (openSession && !body.force) {
        throw new ConflictError(
          `Register ${existing.displayCode} has an open drawer session (opened ${new Date(
            Number(openSession.openedAt)
          ).toISOString()}). Pass force: true to close it and revoke anyway.`
        );
      }

      let closedSession = null;
      if (openSession && body.force) {
        // Closed at its OWN expected cash, never a caller-supplied count —
        // the operator forcing this revoke is not present to count the
        // drawer, so there is no "counted" figure to reconcile against.
        const expectedCash = await adapter.getExpectedDrawerCash(String(openSession.id));
        const note = `revoked_with_open_drawer${body.reason ? `: ${body.reason}` : ''}`;
        closedSession = await adapter.closeDrawerSession(
          String(openSession.id),
          expectedCash,
          expectedCash,
          req.user?.id,
          note
        );
      }

      const result = await revokeCredential(adapter, req.params.id, {
        userId: req.user?.id ?? null,
        reason: body.reason ?? null,
      });
      if (result === 'not_found') {
        throw new NotFoundError('Register');
      }

      logger.info(`Revoked credential for register ${existing.displayCode} (${req.params.id})`);
      await audit(req, {
        action: 'delete',
        entity: 'register_credential',
        entityId: req.params.id,
        before: existing,
        after: { register: result.register, closedDrawerSession: closedSession },
      });

      res.json({
        success: true,
        data: { register: withLiveness(result.register), closedDrawerSession: closedSession },
      });
    } catch (error) {
      next(asValidationError(error));
    }
  }
);

export default router;
