import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import config from '../../config';
import logger from '../../utils/logger';
import { ValidationError, AuthenticationError } from '../../utils/errors';
import { authenticate, AuthRequest } from '../middleware/auth';

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

    // TODO: Get user from database
    // For now, use mock data for development
    const mockUser = {
      id: '1',
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('admin123', 10),
      name: 'Admin User',
      roleIds: ['admin-role-id'],
      status: 'active',
    };

    // Check if user exists
    if (email !== mockUser.email) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, mockUser.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check if user is active
    if (mockUser.status !== 'active') {
      throw new AuthenticationError('Account is inactive');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: mockUser.id,
        email: mockUser.email,
        roleIds: mockUser.roleIds,
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
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          roleIds: mockUser.roleIds,
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

    // TODO: Get full user data from database
    const mockUser = {
      id: req.user.id,
      email: req.user.email,
      name: 'Admin User',
      roleIds: req.user.roleIds,
      status: 'active',
    };

    res.json({
      success: true,
      data: {
        user: mockUser,
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
