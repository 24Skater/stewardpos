import { Router, Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import config from '../../config';
import logger from '../../utils/logger';
import { ValidationError, AuthenticationError } from '../../utils/errors';
import { authenticate, AuthRequest } from '../middleware/auth';
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

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new AuthenticationError('Account is inactive');
    }

    // Update last login
    await adapter.updateUserLastLogin(user.id);

    // Generate JWT token
    // @ts-ignore - expiresIn type compatibility
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        roleIds: user.roleIds,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      data: {
        token,
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
    // @ts-ignore - expiresIn type compatibility
    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        roleIds: req.user.roleIds,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      data: { token },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
