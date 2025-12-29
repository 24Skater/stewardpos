import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Seeder } from '../../services/seeder';
import db from '../../services/database';
import logger from '../../utils/logger';
import config from '../../config';
import componentsRoutes from './components';

const router = Router();
router.use(authenticate);

// Component management routes
router.use('/components', componentsRoutes);

// Users
router.get('/users', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Implement
    res.json({ success: true, data: [] });
  } catch (error) {
    next(error);
  }
});

// Roles
router.get('/roles', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Implement
    res.json({ success: true, data: [] });
  } catch (error) {
    next(error);
  }
});

// Settings
router.get('/settings', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Implement
    res.json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
});

// Audit logs
router.get('/audit', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Implement
    res.json({ success: true, data: [] });
  } catch (error) {
    next(error);
  }
});

// Reset database - clears all data and re-seeds with default data
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
