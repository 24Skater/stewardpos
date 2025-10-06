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

    const passwordHash = await bcrypt.hash('admin123', 10);

    if (this.adapter === 'postgres' && this.pgPool) {
      // Insert user
      const userResult = await this.pgPool.query(
        `INSERT INTO users (email, password_hash, name, status) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        ['admin@example.com', passwordHash, 'Admin User', 'active']
      );

      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;
        
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
      }
    } else if (this.adapter === 'sqlite' && this.sqliteDb) {
      // Insert user
      const result = this.sqliteDb
        .prepare(
          `INSERT OR IGNORE INTO users (email, password_hash, name, status) 
           VALUES (?, ?, ?, ?)`
        )
        .run('admin@example.com', passwordHash, 'Admin User', 'active');

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

    logger.info('✓ Admin user seeded (email: admin@example.com, password: admin123)');
  }

  private async seedSettings(): Promise<void> {
    logger.info('Seeding default settings...');

    const settings = {
      tax_rate_default: 0.0,
      store_name: 'My Store',
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
      { name: 'Electronics', icon: 'laptop' },
      { name: 'Clothing', icon: 'shirt' },
      { name: 'Food & Beverage', icon: 'coffee' },
      { name: 'Books', icon: 'book' },
      { name: 'Home & Garden', icon: 'home' },
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
      {
        name: 'Laptop',
        description: 'High-performance laptop',
        category: 'Electronics',
        base_price: 999.99,
        barcode: '123456789',
      },
      {
        name: 'T-Shirt',
        description: 'Cotton t-shirt',
        category: 'Clothing',
        base_price: 19.99,
        barcode: '987654321',
      },
      {
        name: 'Coffee Beans',
        description: 'Premium coffee beans',
        category: 'Food & Beverage',
        base_price: 12.99,
        barcode: '456789123',
      },
    ];

    for (const product of products) {
      if (this.adapter === 'postgres' && this.pgPool) {
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

        // Add default variant
        if (result.rows.length > 0) {
          await this.pgPool.query(
            `INSERT INTO product_variants (product_id, stock, enabled) 
             VALUES ($1, 100, true)`,
            [result.rows[0].id]
          );
        }
      } else if (this.adapter === 'sqlite' && this.sqliteDb) {
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

        // Add default variant
        if (result.lastInsertRowid) {
          this.sqliteDb
            .prepare(
              `INSERT INTO product_variants (product_id, stock, enabled) 
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
