import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import Database from 'better-sqlite3';
import config from '../config';
import logger from '../utils/logger';

export class Seeder {
  private adapter: 'postgres' | 'sqlite';
  private pgPool?: Pool;
  private sqliteDb?: Database.Database;

  constructor() {
    this.adapter = config.database.adapter as 'postgres' | 'sqlite';
    
    if (this.adapter === 'postgres') {
      this.pgPool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
      });
    } else if (this.adapter === 'sqlite') {
      const filename = config.database.filename || './data/persona-pos.db';
      this.sqliteDb = new Database(filename);
    }
  }

  async seed(): Promise<void> {
    logger.info('Seeding database...');

    try {
      // Seed default roles
      await this.seedRoles();
      
      // Seed admin user
      await this.seedAdminUser();
      
      // Seed default settings
      await this.seedSettings();
      
      // Seed sample categories
      await this.seedCategories();
      
      // Seed sample products
      await this.seedProducts();

      logger.info('✓ Database seeded successfully');
    } catch (error) {
      logger.error('✗ Seeding failed:', error);
      throw error;
    }
  }

  private async seedRoles(): Promise<void> {
    logger.info('Seeding roles...');

    const roles = [
      {
        name: 'Admin',
        system_role: 'admin',
        permissions: JSON.stringify({
          inventory: { read: true, write: true, delete: true },
          reports: { read: true, write: true, delete: true },
          exports: { read: true, write: true, delete: true },
          settings: { read: true, write: true, delete: true },
          users: { read: true, write: true, delete: true },
          services: { read: true, write: true, delete: true },
          customers: { read: true, write: true, delete: true },
        }),
      },
      {
        name: 'Supervisor',
        system_role: 'supervisor',
        permissions: JSON.stringify({
          inventory: { read: true, write: true, delete: true },
          reports: { read: true, write: false, delete: false },
          exports: { read: true, write: false, delete: false },
          settings: { read: true, write: false, delete: false },
          users: { read: true, write: false, delete: false },
          services: { read: true, write: true, delete: true },
          customers: { read: true, write: true, delete: true },
        }),
      },
      {
        name: 'Reporter',
        system_role: 'reporter',
        permissions: JSON.stringify({
          inventory: { read: true, write: false, delete: false },
          reports: { read: true, write: false, delete: false },
          exports: { read: true, write: false, delete: false },
          settings: { read: false, write: false, delete: false },
          users: { read: false, write: false, delete: false },
          services: { read: true, write: false, delete: false },
          customers: { read: true, write: false, delete: false },
        }),
      },
      {
        name: 'Standard',
        system_role: 'standard',
        permissions: JSON.stringify({
          inventory: { read: true, write: false, delete: false },
          reports: { read: false, write: false, delete: false },
          exports: { read: false, write: false, delete: false },
          settings: { read: false, write: false, delete: false },
          users: { read: false, write: false, delete: false },
          services: { read: false, write: false, delete: false },
          customers: { read: false, write: false, delete: false },
        }),
      },
    ];

    for (const role of roles) {
      if (this.adapter === 'postgres' && this.pgPool) {
        await this.pgPool.query(
          `INSERT INTO roles (name, system_role, permissions) 
           VALUES ($1, $2, $3::jsonb) 
           ON CONFLICT (name) DO NOTHING`,
          [role.name, role.system_role, role.permissions]
        );
      } else if (this.adapter === 'sqlite' && this.sqliteDb) {
        this.sqliteDb
          .prepare(
            `INSERT OR IGNORE INTO roles (name, system_role, permissions) 
             VALUES (?, ?, ?)`
          )
          .run(role.name, role.system_role, role.permissions);
      }
    }

    logger.info('✓ Roles seeded');
  }

  private async seedAdminUser(): Promise<void> {
    logger.info('Seeding admin user...');

    const passwordHash = await bcrypt.hash('DemoPass!1', 10);

    if (this.adapter === 'postgres' && this.pgPool) {
      // Update or insert user
      const userResult = await this.pgPool.query(
        `INSERT INTO users (email, password_hash, name, status) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, status = EXCLUDED.status
         RETURNING id`,
        ['admin@demo.local', passwordHash, 'Admin User', 'active']
      );

      // Get user ID (either from insert or existing user)
      let userId: string;
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      } else {
        // If no rows returned (shouldn't happen with RETURNING, but just in case)
        const existingUser = await this.pgPool.query(
          'SELECT id FROM users WHERE email = $1',
          ['admin@demo.local']
        );
        userId = existingUser.rows[0].id;
      }
      
      // Get admin role
      const roleResult = await this.pgPool.query(
        `SELECT id FROM roles WHERE system_role = $1`,
        ['admin']
      );

      if (roleResult.rows.length > 0) {
        const roleId = roleResult.rows[0].id;
        
        // Assign role to user
        await this.pgPool.query(
          `INSERT INTO user_roles (user_id, role_id) 
           VALUES ($1, $2) 
           ON CONFLICT DO NOTHING`,
          [userId, roleId]
        );
      }
    } else if (this.adapter === 'sqlite' && this.sqliteDb) {
      // Update or insert user
      const result = this.sqliteDb
        .prepare(
          `INSERT INTO users (email, password_hash, name, status) 
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, status = excluded.status`
        )
        .run('admin@demo.local', passwordHash, 'Admin User', 'active');

      if (result.changes > 0) {
        const userId = result.lastInsertRowid;
        
        // Get admin role
        const role = this.sqliteDb
          .prepare(`SELECT id FROM roles WHERE system_role = ?`)
          .get('admin') as { id: string } | undefined;

        if (role) {
          // Assign role to user
          this.sqliteDb
            .prepare(
              `INSERT OR IGNORE INTO user_roles (user_id, role_id) 
               VALUES (?, ?)`
            )
            .run(userId, role.id);
        }
      }
    }

    logger.info('✓ Admin user seeded (email: admin@demo.local, password: DemoPass!1)');
  }

  private async seedSettings(): Promise<void> {
    logger.info('Seeding default settings...');

    const settings = {
      tax_rate_default: 0.0,
      store_name: 'StewardPOS',
      store_email: 'store@example.com',
      store_phone: '+1234567890',
      timezone: 'UTC',
      config: JSON.stringify({}),
    };

    if (this.adapter === 'postgres' && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO settings (id, tax_rate_default, store_name, store_email, store_phone, timezone, config) 
         VALUES (1, $1, $2, $3, $4, $5, $6::jsonb) 
         ON CONFLICT (id) DO NOTHING`,
        [
          settings.tax_rate_default,
          settings.store_name,
          settings.store_email,
          settings.store_phone,
          settings.timezone,
          settings.config,
        ]
      );
    } else if (this.adapter === 'sqlite' && this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT OR IGNORE INTO settings (id, tax_rate_default, store_name, store_email, store_phone, timezone, config) 
           VALUES (1, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settings.tax_rate_default,
          settings.store_name,
          settings.store_email,
          settings.store_phone,
          settings.timezone,
          settings.config
        );
    }

    logger.info('✓ Settings seeded');
  }

  private async seedCategories(): Promise<void> {
    logger.info('Seeding sample categories...');

    const categories = [
      { name: 'Chips & Snacks', icon: 'package' },
      { name: 'Drinks', icon: 'coffee' },
      { name: 'Candy', icon: 'candy' },
    ];

    for (const category of categories) {
      if (this.adapter === 'postgres' && this.pgPool) {
        await this.pgPool.query(
          `INSERT INTO categories (name, icon) 
           VALUES ($1, $2) 
           ON CONFLICT (name) DO NOTHING`,
          [category.name, category.icon]
        );
      } else if (this.adapter === 'sqlite' && this.sqliteDb) {
        this.sqliteDb
          .prepare(`INSERT OR IGNORE INTO categories (name, icon) VALUES (?, ?)`)
          .run(category.name, category.icon);
      }
    }

    logger.info('✓ Categories seeded');
  }

  private async seedProducts(): Promise<void> {
    logger.info('Seeding sample products...');

    const products = [
      // Chips & Snacks
      { name: 'Takis', description: 'Spicy rolled tortilla chips', category: 'Chips & Snacks', base_price: 1.00, barcode: '101' },
      { name: 'Pringles', description: 'Stackable potato crisps', category: 'Chips & Snacks', base_price: 2.00, barcode: '102' },
      { name: 'Oreo', description: 'Chocolate sandwich cookies', category: 'Chips & Snacks', base_price: 1.00, barcode: '103' },
      { name: 'Cookies (2 for $1)', description: 'Assorted cookies', category: 'Chips & Snacks', base_price: 0.50, barcode: '104' },
      { name: 'Peanut', description: 'Salted peanuts', category: 'Chips & Snacks', base_price: 1.00, barcode: '105' },
      
      // Drinks
      { name: 'SunnyD', description: 'Orange flavored drink', category: 'Drinks', base_price: 1.00, barcode: '201' },
      { name: 'Apple Juice', description: '100% apple juice', category: 'Drinks', base_price: 1.00, barcode: '202' },
      { name: 'Small Juice', description: 'Small fruit juice', category: 'Drinks', base_price: 1.00, barcode: '203' },
      { name: 'Payaso', description: 'Flavored drink', category: 'Drinks', base_price: 2.00, barcode: '204' },
      
      // Candy
      { name: 'Ring Pop', description: 'Ring-shaped lollipop', category: 'Candy', base_price: 1.00, barcode: '301' },
      { name: 'Chocolate (2 for $1)', description: 'Assorted chocolate bars', category: 'Candy', base_price: 0.50, barcode: '302' },
      { name: 'Lollipop (2 for $1)', description: 'Assorted lollipops', category: 'Candy', base_price: 0.50, barcode: '303' },
    ];

    for (const product of products) {
      if (this.adapter === 'postgres' && this.pgPool) {
        // Check if product already exists by barcode
        const existing = await this.pgPool.query(
          'SELECT id FROM products WHERE barcode = $1',
          [product.barcode]
        );

        if (existing.rows.length > 0) {
          // Product exists, skip seeding
          continue;
        }

        const result = await this.pgPool.query(
          `INSERT INTO products (name, description, category, base_price, barcode) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING id`,
          [
            product.name,
            product.description,
            product.category,
            product.base_price,
            product.barcode,
          ]
        );

        // Add default variant only if product was inserted
        if (result.rows.length > 0) {
          await this.pgPool.query(
            `INSERT INTO product_variants (product_id, stock, enabled) 
             VALUES ($1, 100, true)
             ON CONFLICT DO NOTHING`,
            [result.rows[0].id]
          );
        }
      } else if (this.adapter === 'sqlite' && this.sqliteDb) {
        // Check if product already exists by barcode
        const existing = this.sqliteDb
          .prepare('SELECT id FROM products WHERE barcode = ?')
          .get(product.barcode) as { id: string } | undefined;

        if (existing) {
          // Product exists, skip seeding
          continue;
        }

        const result = this.sqliteDb
          .prepare(
            `INSERT INTO products (name, description, category, base_price, barcode) 
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            product.name,
            product.description,
            product.category,
            product.base_price,
            product.barcode
          );

        // Add default variant only if product was inserted
        if (result.lastInsertRowid) {
          this.sqliteDb
            .prepare(
              `INSERT OR IGNORE INTO product_variants (product_id, stock, enabled) 
               VALUES (?, 100, 1)`
            )
            .run(result.lastInsertRowid);
        }
      }
    }

    logger.info('✓ Products seeded');
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
  }
}

// CLI runner
if (require.main === module) {
  const seeder = new Seeder();
  
  seeder
    .seed()
    .then(() => {
      logger.info('Seeding complete');
      return seeder.close();
    })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Seeding failed:', error);
      seeder.close().then(() => process.exit(1));
    });
}
