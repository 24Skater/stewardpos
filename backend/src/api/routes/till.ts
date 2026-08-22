import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  requireRegisterToken,
  AuthenticatedRegisterRequest,
} from '../middleware/registerAuth';
import { PIN_INVALID, PIN_LOCKED } from '../middleware/registerErrorCodes';
import {
  ValidationError,
  NotFoundError,
  UnprocessableEntityError,
  AuthenticationError,
} from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { mintSession } from '../../services/tillSessions';
import { startShift } from '../../services/registerShifts';

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
router.post(
  '/',
  requireRegisterToken,
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

export default router;
