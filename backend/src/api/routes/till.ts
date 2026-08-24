import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  requireRegisterToken,
  AuthenticatedRegisterRequest,
} from '../middleware/registerAuth';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { PIN_INVALID, PIN_LOCKED } from '../middleware/registerErrorCodes';
import rateLimit from 'express-rate-limit';
import config from '../../config';
import {
  ValidationError,
  NotFoundError,
  UnprocessableEntityError,
  AuthenticationError,
  ForbiddenError,
} from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { mintSession, TILL_SESSION_MAX_AGE } from '../../services/tillSessions';
import { startShift, getOpenShift, endShift } from '../../services/registerShifts';

/**
 * Till sessions.
 *
 * `POST /api/registers/:id/shifts` opens a shift and deliberately returns no
 * token — a PIN sign-on was not a session when it was written. This is the
 * endpoint that makes it one, so a cashier can reach the register without a
 * password. It reuses `startShift` rather than reimplementing the PIN scan, and
 * `requireRegisterToken` rather than trusting a register id from the body: the
 * register is whichever one the device credential proves the caller to be.
 */

const router = Router();

const tillAuthSchema = z
  .object({
    // `.trim().min(1)` mirrors `startShiftSchema` in `registers.ts` — a PIN
    // is either a real value or absent, never whitespace pretending to be one.
    pin: z.string().trim().min(1).optional(),
  })
  // `.strict()` is deliberate: a `registerId` in the body would look like it
  // selects the till, but the till is never taken from the body — see the
  // module comment. Rejecting the extra key outright is safer than silently
  // ignoring it and letting the caller believe it did something.
  .strict();

/**
 * POST /api/auth/till
 *
 * Mint a till session. Authenticated by `X-Register-Token` only — never a
 * user session, since the whole point is to sign a cashier ON without one.
 * The register comes from `req.tokenRegister`, set by `requireRegisterToken`
 * from the verified device credential; it is never read from the body, so a
 * client cannot open a session at a till it is not sitting at.
 *
 * Which of the two modes runs is decided by the register's own
 * `requireSignIn`, not by whether the caller happened to send a PIN — a PIN
 * sent to a register that does not want one is refused (400), not quietly
 * ignored, for the same reason `registerHourlySchema` refuses filters it
 * cannot honour: accepting a parameter and doing nothing with it invites the
 * caller to believe it took effect.
 */
/**
 * Brute-force protection in front of a short PIN, keyed per register.
 *
 * `registers.ts` exports a `shiftLimiter` for the same job, but it keys on
 * `req.params.id` — and this route has no `:id`, so reusing it silently keyed
 * every terminal in every organization to the same `register:unknown` bucket.
 * Ten fumbled PINs at one till would have locked the PIN pad on every till in
 * the shop.
 *
 * The register is known only after `requireRegisterToken` has verified the
 * device credential, which is why this sits *after* it rather than in front:
 * a caller with no valid credential never reaches the PIN comparison at all,
 * so there is nothing here for it to throttle.
 */
const tillPinLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxShiftAttempts,
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    `till:${(req as AuthenticatedRegisterRequest).tokenRegister?.id ?? 'unknown'}`,
  message: 'Too many PIN attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/',
  requireRegisterToken,
  tillPinLimiter,
  async (req: AuthenticatedRegisterRequest, res: Response, next: NextFunction) => {
    try {
      const { pin } = tillAuthSchema.parse(req.body ?? {});
      const register = req.tokenRegister as Record<string, unknown>;
      const registerId = String(register.id);
      const orgId = String(register.orgId);
      const requiresPin = Boolean(register.requireSignIn);

      if (requiresPin && !pin) {
        throw new ValidationError('A PIN is required at this register');
      }
      if (!requiresPin && pin) {
        throw new ValidationError('This register does not use PIN sign-in');
      }

      if (!requiresPin) {
        // No shift, no PIN holder — the session's identity is the register
        // itself. `registerPrincipal: true` is what lets `authenticate` build
        // `req.user` from the token directly on every later request, since
        // `register:<id>` is not a row `getUserByEmail` will ever find; see
        // `services/tillSessions.ts` for the full reasoning.
        const { token, expiresIn } = mintSession({
          user: {
            id: `register:${registerId}`,
            email: `register:${registerId}`,
            roleIds: [],
            orgId,
          },
          registerId,
          registerPrincipal: true,
        });

        res.status(201).json({
          success: true,
          data: {
            token,
            expiresIn,
            register: { id: registerId },
            user: null,
            shift: null,
          },
        });
        return;
      }

      const adapter = db.getAdapter();
      const result = await startShift(adapter, { registerId, pin: pin as string });

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

      logger.info(`Till session opened on register ${registerId} for user ${result.user.id}`);
      await audit(req, {
        action: 'create',
        entity: 'register_shift',
        entityId: String(result.shift.id),
        // No session on this request by design — see the module comment — so
        // the cashier the PIN identified is named explicitly.
        actorUserId: String(result.user.id),
        after: {
          registerId,
          userId: result.user.id,
          supersededShiftId: result.supersededShiftId,
        },
      });

      const { token, expiresIn } = mintSession({
        user: {
          id: String(result.user.id),
          email: String(result.user.email),
          roleIds: (result.user.roleIds as string[]) ?? [],
          orgId,
        },
        shiftId: String(result.shift.id),
        registerId,
      });

      res.status(201).json({
        success: true,
        data: {
          token,
          expiresIn,
          register: { id: registerId },
          user: { id: result.user.id, name: result.user.name, email: result.user.email },
          shift: result.shift,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError(error.errors[0].message));
      } else {
        next(error);
      }
    }
  }
);

const assumeTillSchema = z
  .object({
    registerId: z.string().min(1),
    // Optional: an admin can also open a register with no cashier in mind at
    // all, e.g. to check what the till itself is doing right now.
    emulateUserId: z.string().min(1).optional(),
  })
  .strict();

/**
 * POST /api/auth/till/assume
 *
 * The one way to a till session without the terminal's device credential, so an
 * admin can cover a register or reproduce what a cashier sees from a back-office
 * browser.
 *
 * This is a deliberate hole in the pairing requirement every other till session
 * goes through, and the fence around it is three-sided: `registers:write`, an
 * audit row per use, and a thirty-minute cap that closes a forgotten session.
 *
 * The shift is attributed to the ADMIN. `emulateUserId` is recorded beside it
 * and is never the attributed identity — see the 020 migration for why.
 */
router.post(
  '/assume',
  authenticate,
  requirePermission('registers', 'write'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { registerId, emulateUserId } = assumeTillSchema.parse(req.body ?? {});

      // Without this, an assumed session could mint a fresh assumed session
      // of its own before the first one's thirty minutes were up, and the cap
      // that closes a forgotten session would never actually bind.
      if (req.tillSession?.assumed) {
        throw new ForbiddenError('An assumed session cannot assume another till');
      }

      const admin = req.user!;
      const orgId = req.orgId ?? DEFAULT_ORG_ID;
      const adapter = db.getAdapter();

      const register = await adapter.getRegisterById(registerId);
      // `?? DEFAULT_ORG_ID` on both sides of every org comparison in this
      // route: every row that predates migration 014 has a NULL `org_id`, and
      // `users` has no default, so the seeder writes NULL too. Reading that
      // NULL as "some other org" made the whole staff of an upgraded shop
      // un-emulatable — found by running this endpoint, not by a test, because
      // every fixture set an org explicitly.
      if (!register || String(register.orgId ?? DEFAULT_ORG_ID) !== orgId) {
        throw new NotFoundError('Register');
      }
      if (register.status !== 'active') {
        throw new UnprocessableEntityError('This register is not active');
      }

      let emulatedUser: Record<string, unknown> | null = null;
      if (emulateUserId) {
        const candidate = await adapter.getUserById(emulateUserId);
        if (!candidate || String(candidate.orgId ?? DEFAULT_ORG_ID) !== orgId) {
          throw new NotFoundError('User');
        }
        emulatedUser = candidate;
      }

      // Supersede whoever was already on this till — the same rule a PIN
      // sign-on follows in `startShift`: two people cannot be on one till.
      const openShift = await getOpenShift(adapter, registerId);
      if (openShift) {
        await endShift(adapter, String(openShift.id), 'superseded');
      }

      const shift = await adapter.createRegisterShift({
        registerId,
        userId: admin.id,
        emulatedUserId: emulateUserId,
      });

      // `warn`, not `info`: this is a privileged bypass of device pairing and
      // should stand out in a log scan, not blend in with routine sign-ons.
      logger.warn(
        `Register ${registerId} assumed by admin ${admin.id}` +
          (emulateUserId ? ` (standing in for ${emulateUserId})` : '')
      );
      await audit(req, {
        action: 'create',
        entity: 'register_shift',
        entityId: String(shift.id),
        after: {
          registerId,
          userId: admin.id,
          emulatedUserId: emulateUserId ?? null,
          assumed: true,
        },
      });

      const { token, expiresIn } = mintSession({
        user: {
          id: admin.id,
          email: admin.email,
          roleIds: admin.roleIds,
          orgId,
        },
        shiftId: String(shift.id),
        registerId,
        maxAgeSeconds: TILL_SESSION_MAX_AGE,
        assumed: true,
      });

      res.status(201).json({
        success: true,
        data: {
          token,
          expiresIn,
          register: { id: String(register.id), name: register.name, displayCode: register.displayCode },
          actingAs: emulatedUser ? { id: String(emulatedUser.id), name: emulatedUser.name } : null,
          shift,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError(error.errors[0].message));
      } else {
        next(error);
      }
    }
  }
);

export default router;
