import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import logger from '../../utils/logger';
import { ValidationError, AuthenticationError, ForbiddenError } from '../../utils/errors';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { SHIFT_ENDED, USE_PIN_AT_TILL } from '../middleware/registerErrorCodes';
import { mintSession } from '../../services/tillSessions';
import db from '../../services/database';
import { BCRYPT_ROUNDS } from '../../services/hashing';
import tillRouter from './till';

const router = Router();

// `tillRouter` applies its own PIN rate limiting to `POST /` internally
// (`shiftLimiter`, shared with the PIN endpoint in `registers.ts`); it is
// deliberately not applied here to the whole subrouter, because that would
// also throttle `POST /till/assume` — a route with no PIN to brute-force,
// fenced instead by `registers:write`, an audit row, and a thirty-minute cap.
router.use('/till', tillRouter);

/**
 * Spend the same time a real password check would, then fail.
 *
 * `POST /api/auth/login` answers "Invalid credentials" either way, but it did
 * not *take* the same time either way: an unknown address returned the moment
 * the lookup missed, while a known one paid for a bcrypt verification first. At
 * cost factor 10 that is tens of milliseconds — comfortably measurable over a
 * network, and repeatable enough to average the noise away. So the endpoint
 * still told you which addresses have accounts; it used a stopwatch rather than
 * a message.
 *
 * That matters more here than on a consumer site. These are staff accounts at a
 * named business, so the space of addresses to guess is small, and confirming
 * one turns "spray the internet" into "brute-force this person" — which is
 * exactly what `loginLimiter` is sized to resist, and what a confirmed list of
 * valid addresses makes worth the attempt.
 *
 * The decoy is a hash of 32 random bytes generated in this process, at the
 * install's own `BCRYPT_ROUNDS`. Random rather than a constant so that nothing
 * an attacker can send could ever verify against it, and at the configured cost
 * so that raising the factor speeds up neither branch relative to the other —
 * a fixed hash at cost 10 would leak the difference again on an install that
 * chose 12.
 *
 * Built on first use rather than at import: it costs a full bcrypt hash, and
 * making every module that imports this route pay for it at load time would
 * slow the test suite and the boot for something most requests never touch.
 */
let decoyHash: string | null = null;

function getDecoyHash(): string {
  if (decoyHash === null) {
    decoyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  }
  return decoyHash;
}

/**
 * Always returns false. The return value exists so that callers read as a
 * comparison rather than as a bare side effect.
 */
async function burnPasswordComparison(password: string): Promise<false> {
  await bcrypt.compare(password, getDecoyHash());
  return false;
}

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input
    const { email, password } = loginSchema.parse(req.body);

    // Get user from database
    const adapter = db.getAdapter();
    const user = await adapter.getUserByEmail(email);

    // Check if user exists. The decoy comparison is what keeps the timing of
    // this branch indistinguishable from a wrong password below - see
    // DECOY_PASSWORD_HASH.
    if (!user) {
      await burnPasswordComparison(password);
      throw new AuthenticationError('Invalid credentials');
    }

    // Verify password. A non-string hash means a corrupt or half-written user row —
    // fail closed rather than handing it to bcrypt.
    if (typeof user.passwordHash !== 'string') {
      logger.error(`User ${String(user.id)} has no usable password hash`);
      await burnPasswordComparison(password);
      throw new AuthenticationError('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new AuthenticationError('Account is inactive');
    }

    /**
     * The password form is the back-office door; the till has its own.
     *
     * Deliberately after the password comparison: refusing earlier would turn
     * this endpoint into an oracle for which addresses belong to cashiers.
     *
     * "Every role is `standard`" rather than "any role is `standard`" — a
     * cashier who is also a Reporter has back-office work to do, and a user
     * with no roles has no business here either way.
     */
    const roles = (user.roles as { systemRole?: string }[]) ?? [];
    const isTillOnly = roles.length === 0 || roles.every((role) => role.systemRole === 'standard');
    if (isTillOnly) {
      logger.info(`Refused password login for till-only user ${email}`);
      throw new ForbiddenError('Use your PIN at the till.', USE_PIN_AT_TILL);
    }

    // Update last login
    await adapter.updateUserLastLogin(String(user.id));

    const { token, expiresIn } = mintSession({
      user: {
        id: String(user.id),
        email: String(user.email),
        roleIds: (user.roleIds as string[]) ?? [],
        orgId: user.orgId as string | undefined,
      },
    });

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      data: {
        token,
        // The client cannot read the token's `exp` without decoding it, and it
        // used to assume a 7-day lifetime regardless of what the server issued.
        // Deployed without JWT_EXPIRES_IN the server signs for 24h, so that
        // assumption left the client sitting on a dead token for six days,
        // never refreshing, 401ing on every call. Say it explicitly instead.
        expiresIn,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roleIds: user.roleIds,
          roles: user.roles,
        },
      },
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
 * POST /api/auth/logout
 * User logout
 */
router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  logger.info(`User logged out: ${req.user?.email}`);
  
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * GET /api/auth/session
 * Get current session
 */
router.get('/session', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AuthenticationError('No active session');
    }

    // Get full user data from database
    const adapter = db.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roleIds: user.roleIds,
          status: user.status,
          roles: user.roles,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AuthenticationError('No active session');
    }

    // An assumed session is capped at TILL_SESSION_MAX_AGE precisely because it
    // bypassed device pairing. Re-minting would let a 30-minute grant be held
    // open indefinitely by the client's own refresh timer, so it is refused and
    // the admin assumes the till again.
    if (req.tillSession?.assumed) {
      throw new AuthenticationError('An assumed till session cannot be extended', SHIFT_ENDED);
    }

    // The binding is carried forward, never dropped. `authenticate` has already
    // confirmed the shift is still open, so re-minting with the same shiftId is
    // safe; minting WITHOUT it would hand back a token that outlives the shift.
    const { token, expiresIn } = mintSession({
      user: {
        id: req.user.id,
        email: req.user.email,
        roleIds: req.user.roleIds,
        orgId: req.orgId ?? DEFAULT_ORG_ID,
      },
      shiftId: req.tillSession?.shiftId,
      registerId: req.tillSession?.registerId,
    });

    res.json({
      success: true,
      data: { token, expiresIn },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
