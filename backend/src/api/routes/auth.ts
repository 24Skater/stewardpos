import { Router, Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import config from '../../config';
import logger from '../../utils/logger';
import { ValidationError, AuthenticationError } from '../../utils/errors';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import db from '../../services/database';

const router = Router();

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

    // Generate JWT token
    // @ts-expect-error - expiresIn type compatibility
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        roleIds: user.roleIds,
        // Carried so a consumer can read the tenant without a lookup. The
        // middleware still prefers the stored value; see there for why.
        orgId: user.orgId ?? DEFAULT_ORG_ID,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

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
        expiresIn: config.jwt.expiresIn,
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

    // Generate new token
    // @ts-expect-error - expiresIn type compatibility
    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        roleIds: req.user.roleIds,
        orgId: req.orgId ?? DEFAULT_ORG_ID,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      data: { token, expiresIn: config.jwt.expiresIn },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
