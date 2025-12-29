import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Seeder } from '../../services/seeder';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import config from '../../config';
import componentsRoutes from './components';

const router = Router();
router.use(authenticate);

// Component management routes
router.use('/components', componentsRoutes);

// ===== User Management =====

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  roleIds: z.array(z.string()).min(1),
  status: z.enum(['active', 'inactive']).default('active'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleIds: z.array(z.string()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const users = await adapter.getAllUsers();

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users
 * Create new user
 */
router.post('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userData = createUserSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10);

    const user = await adapter.createUser({
      name: userData.name,
      email: userData.email,
      passwordHash,
      roleIds: userData.roleIds,
      status: userData.status,
    });

    logger.info(`Created user: ${user.email} (${user.id})`);

    res.status(201).json({
      success: true,
      data: user,
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
 * PUT /api/admin/users/:id
 * Update user
 */
router.put('/users/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userData = updateUserSchema.parse(req.body);
    const adapter = db.getAdapter();

    const updateData: any = { ...userData };
    
    // Hash password if provided
    if (userData.password) {
      updateData.passwordHash = await bcrypt.hash(userData.password, 10);
      delete updateData.password;
    }

    const user = await adapter.updateUser(id, updateData);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.info(`Updated user: ${id}`);

    res.json({
      success: true,
      data: user,
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
 * DELETE /api/admin/users/:id
 * Delete user
 */
router.delete('/users/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteUser(id);

    if (!deleted) {
      throw new NotFoundError('User not found');
    }

    logger.info(`Deleted user: ${id}`);

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===== Role Management =====

const createRoleSchema = z.object({
  name: z.string().min(1),
  systemRole: z.enum(['admin', 'supervisor', 'reporter', 'standard']).optional(),
  permissions: z.object({
    inventory: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    reports: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    exports: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    settings: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    users: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    services: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
    customers: z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
  }),
});

const updateRoleSchema = createRoleSchema.partial();

/**
 * GET /api/admin/roles
 * List all roles
 */
router.get('/roles', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const roles = await adapter.getAllRoles();

    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/roles
 * Create new role
 */
router.post('/roles', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roleData = createRoleSchema.parse(req.body);
    const adapter = db.getAdapter();
    const role = await adapter.createRole(roleData);

    logger.info(`Created role: ${role.name} (${role.id})`);

    res.status(201).json({
      success: true,
      data: role,
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
 * PUT /api/admin/roles/:id
 * Update role
 */
router.put('/roles/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const roleData = updateRoleSchema.parse(req.body);
    const adapter = db.getAdapter();
    const role = await adapter.updateRole(id, roleData);

    if (!role) {
      throw new NotFoundError('Role not found');
    }

    logger.info(`Updated role: ${id}`);

    res.json({
      success: true,
      data: role,
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
 * DELETE /api/admin/roles/:id
 * Delete role
 */
router.delete('/roles/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteRole(id);

    if (!deleted) {
      throw new NotFoundError('Role not found');
    }

    logger.info(`Deleted role: ${id}`);

    res.json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===== Settings Management =====

const updateSettingsSchema = z.object({
  taxRateDefault: z.number().min(0).max(1).optional(),
  storeName: z.string().optional(),
  storeEmail: z.string().email().optional(),
  storePhone: z.string().optional(),
  timezone: z.string().optional(),
  logoUrl: z.string().url().optional().nullable(),
  iconUrl: z.string().url().optional().nullable(),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  config: z.record(z.any()).optional(),
});

/**
 * GET /api/admin/settings
 * Get settings
 */
router.get('/settings', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const settings = await adapter.getSettings();

    res.json({
      success: true,
      data: settings || {
        taxRateDefault: 0,
        storeName: 'My Store',
        storeEmail: '',
        storePhone: '',
        timezone: 'UTC',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/settings
 * Update settings
 */
router.put('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settingsData = updateSettingsSchema.parse(req.body);
    const adapter = db.getAdapter();
    const settings = await adapter.updateSettings(settingsData);

    logger.info('Settings updated');

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

// ===== Audit Logs =====

/**
 * GET /api/admin/audit
 * Get audit logs
 */
router.get('/audit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const userId = req.query.userId as string | undefined;

    const logs = await adapter.getAuditLogs({ limit, offset, userId });

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    next(error);
  }
});

// ===== Database Reset =====

/**
 * POST /api/admin/reset-database
 * Reset database - clears all data and re-seeds with default data
 */
router.post('/reset-database', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Only allow admin users to reset database
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Check if user has admin role
    const adapter = db.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !user.roles.some((r: any) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    logger.info('Database reset initiated by user:', req.user.email);

    // Initialize seeder (it initializes itself in constructor)
    const seeder = new Seeder();

    // Clear existing data (in reverse order of dependencies)
    const adapterType = config.database.adapter as 'postgres' | 'sqlite';
    
    if (adapterType === 'postgres') {
      const pool = (adapter as any).pool;
      await pool.query('TRUNCATE TABLE order_items CASCADE');
      await pool.query('TRUNCATE TABLE orders CASCADE');
      await pool.query('TRUNCATE TABLE product_variants CASCADE');
      await pool.query('TRUNCATE TABLE products CASCADE');
      await pool.query('TRUNCATE TABLE user_roles CASCADE');
      // Keep users and roles, but reset their associations
      await pool.query('DELETE FROM users WHERE email != $1', ['admin@demo.local']);
    } else if (adapterType === 'sqlite') {
      const sqliteDb = (adapter as any).db;
      sqliteDb.exec(`
        DELETE FROM order_items;
        DELETE FROM orders;
        DELETE FROM product_variants;
        DELETE FROM products;
        DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE email = 'admin@demo.local');
      `);
    }

    // Re-seed the database
    await seeder.seed();
    await seeder.close();

    logger.info('Database reset completed successfully');

    res.json({
      success: true,
      message: 'Database reset successfully. Fresh inventory loaded.',
    });
  } catch (error) {
    logger.error('Database reset failed:', error);
    next(error);
  }
});

export default router;
