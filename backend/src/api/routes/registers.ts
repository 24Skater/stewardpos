import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import {
  requireRegisterToken,
  requireMatchingRegister,
  AuthenticatedRegisterRequest,
} from '../middleware/registerAuth';
import { PIN_INVALID, PIN_LOCKED } from '../middleware/registerErrorCodes';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  AuthenticationError,
} from '../../utils/errors';
import db from '../../services/database';
import config from '../../config';
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
import { startShift, endShift, getOpenShift } from '../../services/registerShifts';

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
 * Several routes below are deliberately registered BEFORE `router.use(authenticate)`
 * and so run without a user session at all:
 *
 * - `POST /pair` — the device has no session to present yet; that's the
 *   whole problem enrolment solves. Rate-limited instead, in `app.ts`.
 * - `POST /:id/heartbeat` — authenticated by `X-Register-Token`
 *   (`requireRegisterToken`/`requireMatchingRegister` in
 *   `middleware/registerAuth.ts`), a device credential, not a user one.
 * - `POST /:id/shifts`, `POST /:id/shifts/end`, `GET /:id/shifts/current` —
 *   same reasoning as heartbeat: a PIN sign-in authenticates a cashier to an
 *   already-authenticated till, not a user session, so these run off the
 *   device token too. See `services/registerShifts.ts` and
 *   `services/pins.ts`.
 *
 * Everything else needs `authenticate` to run first, same as before.
 */
const router = Router();

/**
 * Brute-force protection for `POST /:id/shifts`, in front of a six-digit PIN.
 *
 * Defined here rather than in `app.ts` alongside `pairLimiter`/`loginLimiter`:
 * those are mounted with `app.use(exactPath, limiter)`, which only works
 * because their paths (`/api/registers/pair`, `/api/auth/login`) have no
 * route parameter. `/:id/shifts` does, and `app.use` path-matching is
 * prefix-based — mounting it at `/api/registers/:id/shifts` would also catch
 * `/:id/shifts/end` and `/:id/shifts/current`, which take no PIN and are not
 * what this budget is protecting. Applying it directly to this one route
 * keeps the blast radius exact.
 */
/**
 * Throttle PIN guessing at the till.
 *
 * This is the *primary* brute-force defence on this path, not a backstop. The
 * endpoint takes a bare `{ pin }` and identifies the cashier by comparing it
 * against every PIN holder in the org, so a wrong guess matches nobody and
 * cannot be charged to any one account's lockout counter — charging it to all
 * of them would let a single typo lock out the entire roster. Per-account
 * lockout in `services/pins.ts` is real and tested, but it only engages once a
 * hash has already matched. Here, the limiter is what stands in the way.
 *
 * Keyed on the **register**, not the caller's IP. Three tills in one shop sit
 * behind one NAT address, so IP keying would let a busy lane throttle a quiet
 * one while doing nothing to scope the actual attack surface, which is a person
 * standing at one particular till trying PINs. The register id is safe to key
 * on because `requireRegisterToken` has already verified the device credential
 * that names it — it is authenticated input, not a claim from the request body.
 */
const shiftLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxShiftAttempts,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `register:${req.params.id ?? 'unknown'}`,
  message: 'Too many PIN attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

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

const startShiftSchema = z.object({
  pin: z.string().trim().min(1, 'A PIN is required'),
});

/**
 * POST /api/registers/:id/shifts
 *
 * Sign a cashier on to this register with a PIN. Rate-limited (`shiftLimiter`
 * above) — see there for why it lives here rather than in `app.ts`.
 * Authenticated by `X-Register-Token`, not a user session: the PIN says who
 * is standing at an already-authenticated till, it does not authenticate the
 * till itself. Returns the shift and the cashier's name; NEVER a token — a
 * PIN sign-in is deliberately not a session, see `services/pins.ts`.
 */
router.post(
  '/:id/shifts',
  shiftLimiter,
  requireRegisterToken,
  requireMatchingRegister,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const { pin } = startShiftSchema.parse(req.body);
      const adapter = db.getAdapter();

      const result = await startShift(adapter, { registerId: req.params.id, pin });

      if (result === 'register_not_found') {
        throw new NotFoundError('Register');
      }
      if (result === 'register_not_active') {
        throw new UnprocessableEntityError('This register is not active');
      }
      if (result === 'bad_pin') {
        throw new AuthenticationError('That PIN was not recognized', PIN_INVALID);
      }
      if (result === 'locked') {
        throw new AuthenticationError(
          'This PIN is locked after too many failed attempts. Try again later.',
          PIN_LOCKED
        );
      }

      logger.info(`Shift started on register ${req.params.id} for user ${result.user.id}`);
      await audit(req, {
        action: 'create',
        entity: 'register_shift',
        entityId: String(result.shift.id),
        after: {
          registerId: req.params.id,
          userId: result.user.id,
          supersededShiftId: result.supersededShiftId,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          shift: result.shift,
          cashier: { id: result.user.id, name: result.user.name },
        },
      });
    } catch (error) {
      next(asValidationError(error));
    }
  }
);

/**
 * POST /api/registers/:id/shifts/end
 *
 * Sign out whoever is currently on this register. A no-op-shaped 404 when
 * nothing is open — including when the open shift just turned out to be
 * idle-expired, since `getOpenShift` ends that lazily and reports null the
 * same as "nothing was ever open".
 */
router.post(
  '/:id/shifts/end',
  requireRegisterToken,
  requireMatchingRegister,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const adapter = db.getAdapter();
      const openShift = await getOpenShift(adapter, req.params.id);
      if (!openShift) {
        throw new NotFoundError('Open shift');
      }

      const ended = await endShift(adapter, String(openShift.id), 'signed_out');

      logger.info(`Shift ${openShift.id} signed out on register ${req.params.id}`);
      await audit(req, {
        action: 'update',
        entity: 'register_shift',
        entityId: String(openShift.id),
        before: openShift,
        after: ended,
      });

      res.json({ success: true, data: { shift: ended } });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/registers/:id/shifts/current
 *
 * Who is currently on this register, or null. Used by the till to decide
 * whether to show a lock screen.
 */
router.get(
  '/:id/shifts/current',
  requireRegisterToken,
  requireMatchingRegister,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const adapter = db.getAdapter();
      const openShift = await getOpenShift(adapter, req.params.id);
      if (!openShift) {
        res.json({ success: true, data: null });
        return;
      }

      const cashier = await adapter.getUserById(String(openShift.userId));

      res.json({
        success: true,
        data: {
          shift: openShift,
          cashier: cashier ? { id: cashier.id, name: cashier.name } : null,
        },
      });
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
