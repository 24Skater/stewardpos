import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import db from '../../services/database';
import logger from '../../utils/logger';
import { Migrator } from '../../services/migrator';
import { Seeder } from '../../services/seeder';
import config from '../../config';
import { ValidationError, DatabaseError } from '../../utils/errors';

const router = Router();

// Setup state check - no auth required
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    
    // Check if database is initialized
    let isInitialized = false;
    try {
      // Try to query a system table to see if migrations have run
      if (config.database.adapter === 'postgres') {
        const pool = (adapter as any).pool;
        const result = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')"
        );
        isInitialized = result.rows[0].exists;
      } else {
        const sqliteDb = (adapter as any).db;
        const tables = sqliteDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        ).get();
        isInitialized = !!tables;
      }
    } catch (error) {
      // Database not initialized
      isInitialized = false;
    }

    // Check if admin user exists
    let hasAdminUser = false;
    if (isInitialized) {
      try {
        // Check for admin user by querying directly
        if (config.database.adapter === 'postgres') {
          const pool = (adapter as any).pool;
          const result = await pool.query(
            `SELECT COUNT(*) as count 
             FROM users u
             JOIN user_roles ur ON u.id = ur.user_id
             JOIN roles r ON ur.role_id = r.id
             WHERE r.system_role = 'admin'`
          );
          hasAdminUser = parseInt(result.rows[0].count) > 0;
        } else {
          const sqliteDb = (adapter as any).db;
          const result = sqliteDb.prepare(
            `SELECT COUNT(*) as count 
             FROM users u
             JOIN user_roles ur ON u.id = ur.user_id
             JOIN roles r ON ur.role_id = r.id
             WHERE r.system_role = 'admin'`
          ).get() as any;
          hasAdminUser = (result?.count || 0) > 0;
        }
      } catch (error) {
        // Error checking users - assume no admin user
        hasAdminUser = false;
      }
    }

    res.json({
      success: true,
      data: {
        isInitialized,
        hasAdminUser,
        needsSetup: !isInitialized || !hasAdminUser,
        databaseAdapter: config.database.adapter,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Test database connection
router.post('/test-database', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      adapter: z.enum(['postgres', 'sqlite']),
      host: z.string().optional(),
      port: z.coerce.number().optional(),
      name: z.string().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      filename: z.string().optional(),
    });

    const dbConfig = schema.parse(req.body);

    try {
      // Test connection based on adapter
      if (dbConfig.adapter === 'postgres') {
        const { Pool } = await import('pg');
        const pool = new Pool({
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.name,
          user: dbConfig.user,
          password: dbConfig.password,
        });
        await pool.query('SELECT 1');
        await pool.end();
      } else {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbConfig.filename || './data/stewardpos.db');
        db.prepare('SELECT 1').get();
        db.close();
      }

      res.json({
        success: true,
        message: 'Database connection successful',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: `Database connection failed: ${error.message}`,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

// Complete setup
const setupSchema = z.object({
  // Admin user
  adminUser: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
  }),

  // Database configuration
  database: z.object({
    adapter: z.enum(['postgres', 'sqlite']),
    host: z.string().optional(),
    port: z.coerce.number().optional(),
    name: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    filename: z.string().optional(),
  }),

  // Authentication methods
  auth: z.object({
    methods: z.array(z.enum(['local', 'google', 'oidc'])).min(1),
    google: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).optional(),
    oidc: z.object({
      issuer: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).optional(),
  }),

  // Environment
  environment: z.enum(['development', 'staging', 'production']).default('production'),

  // Demo mode
  demoMode: z.boolean().default(false),

  // Data replication (optional)
  replication: z.object({
    enabled: z.boolean().default(false),
    source: z.enum(['dev', 'qa', 'prod']).optional(),
    target: z.enum(['dev', 'qa', 'prod']).optional(),
  }).optional(),
});

router.post('/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setupData = setupSchema.parse(req.body);

    // Step 1: Test database connection
    logger.info('Testing database connection...');
    try {
      if (setupData.database.adapter === 'postgres') {
        const { Pool } = await import('pg');
        const pool = new Pool({
          host: setupData.database.host,
          port: setupData.database.port,
          database: setupData.database.name,
          user: setupData.database.user,
          password: setupData.database.password,
        });
        await pool.query('SELECT 1');
        await pool.end();
      } else {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(setupData.database.filename || './data/stewardpos.db');
        db.prepare('SELECT 1').get();
        db.close();
      }
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: `Database connection failed: ${error.message}`,
      });
    }

    // Step 2: Run migrations
    logger.info('Running database migrations...');
    try {
      // Only update config if not in demo mode (demo uses existing env vars)
      if (!setupData.demoMode) {
        process.env.DB_ADAPTER = setupData.database.adapter;
        if (setupData.database.host) process.env.DB_HOST = setupData.database.host;
        if (setupData.database.port) process.env.DB_PORT = setupData.database.port.toString();
        if (setupData.database.name) process.env.DB_NAME = setupData.database.name;
        if (setupData.database.user) process.env.DB_USER = setupData.database.user;
        if (setupData.database.password) process.env.DB_PASSWORD = setupData.database.password;
        if (setupData.database.filename) process.env.DB_FILENAME = setupData.database.filename;
      }

      const migrator = new Migrator();
      await migrator.runMigrations();
    } catch (error: any) {
      logger.error('Migration failed:', error);
      return res.status(500).json({
        success: false,
        error: `Migration failed: ${error.message}`,
      });
    }

    // Step 3: Create admin user
    logger.info('Creating admin user...');
    try {
      const adapter = db.getAdapter();
      const passwordHash = await bcrypt.hash(setupData.adminUser.password, 10);

      if (config.database.adapter === 'postgres') {
        const pool = (adapter as any).pool;
        
        // Get admin role
        const roleResult = await pool.query(
          "SELECT id FROM roles WHERE system_role = 'admin'"
        );
        
        if (roleResult.rows.length === 0) {
          // Create admin role first
          const newRoleResult = await pool.query(
            `INSERT INTO roles (name, system_role, permissions)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [
              'Administrator',
              'admin',
              JSON.stringify({
                inventory: { read: true, write: true, delete: true },
                reports: { read: true, write: true, delete: true },
                exports: { read: true, write: true, delete: true },
                settings: { read: true, write: true, delete: true },
                users: { read: true, write: true, delete: true },
                services: { read: true, write: true, delete: true },
                customers: { read: true, write: true, delete: true },
              }),
            ]
          );
          const roleId = newRoleResult.rows[0].id;

          // Create admin user
          const userResult = await pool.query(
            `INSERT INTO users (email, password_hash, name, status)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [setupData.adminUser.email, passwordHash, setupData.adminUser.name, 'active']
          );
          const userId = userResult.rows[0].id;

          // Assign admin role
          await pool.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
            [userId, roleId]
          );
        } else {
          const roleId = roleResult.rows[0].id;

          // Create admin user
          const userResult = await pool.query(
            `INSERT INTO users (email, password_hash, name, status)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET
               password_hash = EXCLUDED.password_hash,
               name = EXCLUDED.name,
               status = EXCLUDED.status
             RETURNING id`,
            [setupData.adminUser.email, passwordHash, setupData.adminUser.name, 'active']
          );
          const userId = userResult.rows[0].id;

          // Assign admin role
          await pool.query(
            `INSERT INTO user_roles (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [userId, roleId]
          );
        }
      } else {
        const sqliteDb = (adapter as any).db;
        
        // Get or create admin role
        let role = sqliteDb.prepare("SELECT id FROM roles WHERE system_role = ?").get('admin') as any;
        if (!role) {
          const roleResult = sqliteDb.prepare(
            `INSERT INTO roles (name, system_role, permissions)
             VALUES (?, ?, ?)`
          ).run(
            'Administrator',
            'admin',
            JSON.stringify({
              inventory: { read: true, write: true, delete: true },
              reports: { read: true, write: true, delete: true },
              exports: { read: true, write: true, delete: true },
              settings: { read: true, write: true, delete: true },
              users: { read: true, write: true, delete: true },
              services: { read: true, write: true, delete: true },
              customers: { read: true, write: true, delete: true },
            })
          );
          role = { id: roleResult.lastInsertRowid };
        }

        // Create admin user
        const userResult = sqliteDb.prepare(
          `INSERT INTO users (email, password_hash, name, status)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             name = EXCLUDED.name,
             status = EXCLUDED.status`
        ).run(
          setupData.adminUser.email,
          passwordHash,
          setupData.adminUser.name,
          'active'
        );

        const userId = userResult.lastInsertRowid || sqliteDb.prepare("SELECT id FROM users WHERE email = ?").get(setupData.adminUser.email)?.id;

        // Assign admin role
        sqliteDb.prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`
        ).run(userId, role.id);
      }
    } catch (error: any) {
      logger.error('Failed to create admin user:', error);
      return res.status(500).json({
        success: false,
        error: `Failed to create admin user: ${error.message}`,
      });
    }

    // Step 4: Seed demo data if demo mode
    // Note: Seeder now checks for existing products to prevent duplicates
    if (setupData.demoMode) {
      logger.info('Seeding demo data...');
      try {
        const seeder = new Seeder();
        await seeder.seed();
        await seeder.close();
      } catch (error: any) {
        logger.warn('Demo seeding failed (non-critical):', error);
      }
    }

    // Step 5: Save configuration (write to .env or config file)
    // Note: In production, this should be handled by the deployment system
    // For now, we'll just log the configuration
    logger.info('Setup configuration:', {
      environment: setupData.environment,
      authMethods: setupData.auth.methods,
      demoMode: setupData.demoMode,
    });

    res.json({
      success: true,
      message: 'Setup completed successfully',
      data: {
        adminEmail: setupData.adminUser.email,
        environment: setupData.environment,
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

export default router;

