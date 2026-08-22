import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import logger from '../../utils/logger';
import { ValidationError, AuthenticationError } from '../../utils/errors';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { SHIFT_ENDED } from '../middleware/registerErrorCodes';
import { mintSession } from '../../services/tillSessions';
import db from '../../services/database';
import tillRouter from './till';
import { shiftLimiter } from './registers';

const router = Router();

// Brute-force protection in front of a short PIN, the same limiter the
// existing shift endpoint uses.
router.use('/till', shiftLimiter, tillRouter);

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

    // Check if user exists
    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Verify password. A non-string hash means a corrupt or half-written user row —
    // fail closed rather than handing it to bcrypt.
    if (typeof user.passwordHash !== 'string') {
      logger.error(`User ${String(user.id)} has no usable password hash`);
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
