import { Pool } from 'pg';
import logger from '../../utils/logger';
import { DatabaseError } from '../../utils/errors';

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export class PostgresAdapter {
  private pool: Pool;

  constructor(config: PostgresConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client', err);
    });

    logger.info('PostgreSQL adapter initialized');
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('PostgreSQL connection test successful');
      return true;
    } catch (error) {
      logger.error('PostgreSQL connection test failed:', error);
      return false;
    }
  }

  // User Operations
  async getUserByEmail(email: string): Promise<any> {
    try {
      const result = await this.pool.query(
        `SELECT u.*, 
                array_agg(r.id) as role_ids,
                array_agg(r.*) as roles
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id
         WHERE u.email = $1
         GROUP BY u.id`,
        [email]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];
      
      // Parse roles
      if (user.roles && user.roles[0]) {
        user.roles = user.roles.map((r: any) => ({
          id: r.id,
          name: r.name,
          systemRole: r.system_role,
          permissions: typeof r.permissions === 'string' 
            ? JSON.parse(r.permissions) 
            : r.permissions,
        }));
      } else {
        user.roles = [];
      }

      return {
        id: user.id,
        email: user.email,
        passwordHash: user.password_hash,
        name: user.name,
        roleIds: user.role_ids || [],
        status: user.status,
        lastLoginAt: user.last_login_at ? new Date(user.last_login_at).getTime() : undefined,
        createdAt: new Date(user.created_at).getTime(),
        roles: user.roles,
      };
    } catch (error) {
      logger.error('Error getting user by email:', error);
      throw new DatabaseError('Failed to get user');
    }
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
        [userId]
      );
    } catch (error) {
      logger.error('Error updating user last login:', error);
      throw new DatabaseError('Failed to update user');
    }
  }

  // Product Operations
  async getAllProducts(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT p.*, 
                json_agg(
                  json_build_object(
                    'id', pv.id,
                    'size', pv.size,
                    'color', pv.color,
                    'priceOverride', pv.price_override,
                    'priceDelta', pv.price_delta,
                    'sku', pv.sku,
                    'barcode', pv.barcode,
                    'stock', pv.stock,
                    'enabled', pv.enabled
                  )
                ) FILTER (WHERE pv.id IS NOT NULL) as variants
         FROM products p
         LEFT JOIN product_variants pv ON p.id = pv.product_id
         GROUP BY p.id
         ORDER BY p.name ASC`
      );

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        basePrice: parseFloat(row.base_price),
        image: row.image,
        barcode: row.barcode,
        variants: row.variants || [],
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all products:', error);
      throw new DatabaseError('Failed to get products');
    }
  }

  async getProductById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `SELECT p.*, 
                json_agg(
                  json_build_object(
                    'id', pv.id,
                    'size', pv.size,
                    'color', pv.color,
                    'priceOverride', pv.price_override,
                    'priceDelta', pv.price_delta,
                    'sku', pv.sku,
                    'barcode', pv.barcode,
                    'stock', pv.stock,
                    'enabled', pv.enabled
                  )
                ) FILTER (WHERE pv.id IS NOT NULL) as variants
         FROM products p
         LEFT JOIN product_variants pv ON p.id = pv.product_id
         WHERE p.id = $1
         GROUP BY p.id`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        basePrice: parseFloat(row.base_price),
        image: row.image,
        barcode: row.barcode,
        variants: row.variants || [],
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error getting product by ID:', error);
      throw new DatabaseError('Failed to get product');
    }
  }

  async createProduct(product: any): Promise<any> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert product
      const productResult = await client.query(
        `INSERT INTO products (name, description, category, base_price, image, barcode)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          product.name,
          product.description,
          product.category,
          product.basePrice,
          product.image,
          product.barcode,
        ]
      );

      const newProduct = productResult.rows[0];

      // Insert variants if provided
      const variants = [];
      if (product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          const variantResult = await client.query(
            `INSERT INTO product_variants 
             (product_id, size, color, price_override, price_delta, sku, barcode, stock, enabled)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              newProduct.id,
              variant.size,
              variant.color,
              variant.priceOverride,
              variant.priceDelta,
              variant.sku,
              variant.barcode,
              variant.stock || 0,
              variant.enabled !== false,
            ]
          );
          variants.push(variantResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      return {
        id: newProduct.id,
        name: newProduct.name,
        description: newProduct.description,
        category: newProduct.category,
        basePrice: parseFloat(newProduct.base_price),
        image: newProduct.image,
        barcode: newProduct.barcode,
        variants,
        createdAt: new Date(newProduct.created_at).getTime(),
        updatedAt: new Date(newProduct.updated_at).getTime(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating product:', error);
      throw new DatabaseError('Failed to create product');
    } finally {
      client.release();
    }
  }

  async updateProduct(id: string, product: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `UPDATE products 
         SET name = $1, description = $2, category = $3, base_price = $4, 
             image = $5, barcode = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [
          product.name,
          product.description,
          product.category,
          product.basePrice,
          product.image,
          product.barcode,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        basePrice: parseFloat(row.base_price),
        image: row.image,
        barcode: row.barcode,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error updating product:', error);
      throw new DatabaseError('Failed to update product');
    }
  }

  async deleteProduct(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM products WHERE id = $1',
        [id]
      );
      return result.rowCount ? result.rowCount > 0 : false;
    } catch (error) {
      logger.error('Error deleting product:', error);
      throw new DatabaseError('Failed to delete product');
    }
  }

  // Order Operations
  async createOrder(order: any): Promise<any> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert order
      const orderResult = await client.query(
        `INSERT INTO orders (subtotal, discount_total, tax_total, total, payment_method, customer_email, customer_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          order.subtotal,
          order.discountTotal || 0,
          order.taxTotal || 0,
          order.total,
          order.paymentMethod,
          order.customerEmail,
          order.customerPhone,
        ]
      );

      const newOrder = orderResult.rows[0];

      // Insert order items
      const items = [];
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          const itemResult = await client.query(
            `INSERT INTO order_items 
             (order_id, product_id, variant_id, name_snapshot, size, color, quantity, unit_price, line_discount, line_total, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              newOrder.id,
              item.productId,
              item.variantId,
              item.nameSnapshot,
              item.size,
              item.color,
              item.quantity,
              item.unitPrice,
              item.lineDiscount || 0,
              item.lineTotal,
              item.notes,
            ]
          );
          items.push(itemResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      return {
        id: newOrder.id,
        createdAt: new Date(newOrder.created_at).getTime(),
        subtotal: parseFloat(newOrder.subtotal),
        discountTotal: parseFloat(newOrder.discount_total),
        taxTotal: parseFloat(newOrder.tax_total),
        total: parseFloat(newOrder.total),
        paymentMethod: newOrder.payment_method,
        customerEmail: newOrder.customer_email,
        customerPhone: newOrder.customer_phone,
        items,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating order:', error);
      throw new DatabaseError('Failed to create order');
    } finally {
      client.release();
    }
  }

  async getAllOrders(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM orders ORDER BY created_at DESC`
      );

      return result.rows.map((order) => ({
        id: order.id,
        createdAt: new Date(order.created_at).getTime(),
        subtotal: parseFloat(order.subtotal),
        discountTotal: parseFloat(order.discount_total),
        taxTotal: parseFloat(order.tax_total),
        total: parseFloat(order.total),
        paymentMethod: order.payment_method,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
      }));
    } catch (error) {
      logger.error('Error getting all orders:', error);
      throw new DatabaseError('Failed to get orders');
    }
  }

  async getOrderById(id: string): Promise<any | null> {
    try {
      const orderResult = await this.pool.query(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (orderResult.rows.length === 0) {
        return null;
      }

      const order = orderResult.rows[0];

      const itemsResult = await this.pool.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [id]
      );

      return {
        id: order.id,
        createdAt: new Date(order.created_at).getTime(),
        subtotal: parseFloat(order.subtotal),
        discountTotal: parseFloat(order.discount_total),
        taxTotal: parseFloat(order.tax_total),
        total: parseFloat(order.total),
        paymentMethod: order.payment_method,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        items: itemsResult.rows.map((item) => ({
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          nameSnapshot: item.name_snapshot,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unit_price),
          lineDiscount: parseFloat(item.line_discount),
          lineTotal: parseFloat(item.line_total),
          notes: item.notes,
        })),
      };
    } catch (error) {
      logger.error('Error getting order by ID:', error);
      throw new DatabaseError('Failed to get order');
    }
  }

  async getAllCustomers(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM customers ORDER BY name ASC'
      );

      return result.rows.map((c) => ({
        id: c.id,
        name: c.name,
        org: c.org,
        email: c.email,
        phone: c.phone,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        country: c.country,
        notes: c.notes,
        createdAt: new Date(c.created_at).getTime(),
        updatedAt: new Date(c.updated_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all customers:', error);
      throw new DatabaseError('Failed to get customers');
    }
  }

  async createCustomer(customer: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO customers (name, org, email, phone, address, city, state, zip, country, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          customer.name,
          customer.org,
          customer.email,
          customer.phone,
          customer.address,
          customer.city,
          customer.state,
          customer.zip,
          customer.country,
          customer.notes,
        ]
      );

      const created = result.rows[0];
      return {
        id: created.id,
        name: created.name,
        org: created.org,
        email: created.email,
        phone: created.phone,
        address: created.address,
        city: created.city,
        state: created.state,
        zip: created.zip,
        country: created.country,
        notes: created.notes,
        createdAt: new Date(created.created_at).getTime(),
        updatedAt: new Date(created.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error creating customer:', error);
      throw new DatabaseError('Failed to create customer');
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL connection pool closed');
  }
}
