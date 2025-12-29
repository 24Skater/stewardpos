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
                COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), ARRAY[]::uuid[]) as role_ids,
                COALESCE(json_agg(json_build_object(
                  'id', r.id,
                  'name', r.name,
                  'system_role', r.system_role,
                  'permissions', r.permissions
                )) FILTER (WHERE r.id IS NOT NULL), '[]'::json) as roles
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
      
      // Parse roles - roles is now a JSON array
      let roles: any[] = [];
      if (user.roles) {
        try {
          const rolesArray = typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles;
          if (Array.isArray(rolesArray)) {
            roles = rolesArray.map((r: any) => ({
              id: r.id,
              name: r.name,
              systemRole: r.system_role,
              permissions: typeof r.permissions === 'string' 
                ? JSON.parse(r.permissions) 
                : r.permissions,
            }));
          }
        } catch (e) {
          logger.warn('Error parsing roles:', e);
          roles = [];
        }
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
        roles: roles,
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

      // Insert order items and update stock
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

          // Update variant stock if variantId is provided
          if (item.variantId) {
            await client.query(
              `UPDATE product_variants 
               SET stock = GREATEST(0, stock - $1)
               WHERE id = $2`,
              [item.quantity, item.variantId]
            );
          }
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

      // Get all order items in one query for efficiency
      const orderIds = result.rows.map(o => o.id);
      let itemsMap = new Map<string, any[]>();
      
      if (orderIds.length > 0) {
        const itemsResult = await this.pool.query(
          `SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])`,
          [orderIds]
        );
        
        // Group items by order_id
        itemsResult.rows.forEach((item) => {
          const orderId = item.order_id;
          if (!itemsMap.has(orderId)) {
            itemsMap.set(orderId, []);
          }
          itemsMap.get(orderId)!.push({
            id: item.id,
            orderId: item.order_id,
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
          });
        });
      }

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
        items: itemsMap.get(order.id) || [],
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
          orderId: item.order_id,
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

  async getCustomerById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM customers WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const c = result.rows[0];
      return {
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
        tags: [],
        lifetimeValue: 0,
        createdAt: new Date(c.created_at).getTime(),
        updatedAt: new Date(c.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error getting customer by ID:', error);
      throw new DatabaseError('Failed to get customer');
    }
  }

  async updateCustomer(id: string, customer: any): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE customers SET 
           name = COALESCE($1, name),
           org = COALESCE($2, org),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           address = COALESCE($5, address),
           city = COALESCE($6, city),
           state = COALESCE($7, state),
           zip = COALESCE($8, zip),
           country = COALESCE($9, country),
           notes = COALESCE($10, notes),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $11
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
          id,
        ]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const c = result.rows[0];
      return {
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
        tags: [],
        lifetimeValue: 0,
        createdAt: new Date(c.created_at).getTime(),
        updatedAt: new Date(c.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error updating customer:', error);
      throw new DatabaseError('Failed to update customer');
    }
  }

  async deleteCustomer(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM customers WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting customer:', error);
      throw new DatabaseError('Failed to delete customer');
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL connection pool closed');
  }

  // ===== Service Operations =====
  async getAllServices(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM services ORDER BY name ASC'
      );

      return result.rows.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price ? parseFloat(s.base_price) : null,
        unitType: s.unit_type,
        isActive: s.is_active,
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all services:', error);
      throw new DatabaseError('Failed to get services');
    }
  }

  async getServiceById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM services WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const s = result.rows[0];
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price ? parseFloat(s.base_price) : null,
        unitType: s.unit_type,
        isActive: s.is_active,
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error getting service by ID:', error);
      throw new DatabaseError('Failed to get service');
    }
  }

  async createService(service: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO services (name, category, description, base_price, unit_type, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          service.name,
          service.category,
          service.description,
          service.basePrice,
          service.unitType || 'flat',
          service.isActive !== false,
        ]
      );

      const s = result.rows[0];
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price ? parseFloat(s.base_price) : null,
        unitType: s.unit_type,
        isActive: s.is_active,
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error creating service:', error);
      throw new DatabaseError('Failed to create service');
    }
  }

  async updateService(id: string, service: any): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE services 
         SET name = COALESCE($1, name),
             category = COALESCE($2, category),
             description = COALESCE($3, description),
             base_price = COALESCE($4, base_price),
             unit_type = COALESCE($5, unit_type),
             is_active = COALESCE($6, is_active),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [
          service.name,
          service.category,
          service.description,
          service.basePrice,
          service.unitType,
          service.isActive,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const s = result.rows[0];
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price ? parseFloat(s.base_price) : null,
        unitType: s.unit_type,
        isActive: s.is_active,
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error updating service:', error);
      throw new DatabaseError('Failed to update service');
    }
  }

  async deleteService(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM services WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting service:', error);
      throw new DatabaseError('Failed to delete service');
    }
  }

  // ===== User Operations =====
  async getAllUsers(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT u.*, 
                COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), ARRAY[]::uuid[]) as role_ids,
                COALESCE(json_agg(json_build_object(
                  'id', r.id,
                  'name', r.name,
                  'systemRole', r.system_role,
                  'permissions', r.permissions
                )) FILTER (WHERE r.id IS NOT NULL), '[]'::json) as roles
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id
         GROUP BY u.id
         ORDER BY u.name ASC`
      );

      return result.rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        roleIds: u.role_ids || [],
        roles: u.roles || [],
        lastLoginAt: u.last_login_at ? new Date(u.last_login_at).getTime() : null,
        createdAt: new Date(u.created_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw new DatabaseError('Failed to get users');
    }
  }

  async createUser(user: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO users (email, password_hash, name, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [user.email, user.passwordHash, user.name, user.status || 'active']
      );

      const newUser = result.rows[0];

      // Assign roles if provided
      if (user.roleIds && user.roleIds.length > 0) {
        for (const roleId of user.roleIds) {
          await client.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
            [newUser.id, roleId]
          );
        }
      }

      await client.query('COMMIT');

      return {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        status: newUser.status,
        roleIds: user.roleIds || [],
        createdAt: new Date(newUser.created_at).getTime(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating user:', error);
      throw new DatabaseError('Failed to create user');
    } finally {
      client.release();
    }
  }

  async updateUser(id: string, user: any): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (user.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(user.name);
      }
      if (user.email !== undefined) {
        updates.push(`email = $${paramIndex++}`);
        values.push(user.email);
      }
      if (user.passwordHash !== undefined) {
        updates.push(`password_hash = $${paramIndex++}`);
        values.push(user.passwordHash);
      }
      if (user.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(user.status);
      }

      values.push(id);

      const result = await client.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Update roles if provided
      if (user.roleIds !== undefined) {
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
        for (const roleId of user.roleIds) {
          await client.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
            [id, roleId]
          );
        }
      }

      await client.query('COMMIT');

      const updatedUser = result.rows[0];
      return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        status: updatedUser.status,
        roleIds: user.roleIds || [],
        createdAt: new Date(updatedUser.created_at).getTime(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating user:', error);
      throw new DatabaseError('Failed to update user');
    } finally {
      client.release();
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw new DatabaseError('Failed to delete user');
    }
  }

  // ===== Role Operations =====
  async getAllRoles(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM roles ORDER BY name ASC'
      );

      return result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: typeof r.permissions === 'string' 
          ? JSON.parse(r.permissions) 
          : r.permissions,
      }));
    } catch (error) {
      logger.error('Error getting all roles:', error);
      throw new DatabaseError('Failed to get roles');
    }
  }

  async getRoleById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM roles WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const r = result.rows[0];
      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: typeof r.permissions === 'string' 
          ? JSON.parse(r.permissions) 
          : r.permissions,
      };
    } catch (error) {
      logger.error('Error getting role by ID:', error);
      throw new DatabaseError('Failed to get role');
    }
  }

  async createRole(role: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO roles (name, system_role, permissions)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [role.name, role.systemRole, JSON.stringify(role.permissions)]
      );

      const r = result.rows[0];
      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: typeof r.permissions === 'string' 
          ? JSON.parse(r.permissions) 
          : r.permissions,
      };
    } catch (error) {
      logger.error('Error creating role:', error);
      throw new DatabaseError('Failed to create role');
    }
  }

  async updateRole(id: string, role: any): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE roles 
         SET name = COALESCE($1, name),
             system_role = COALESCE($2, system_role),
             permissions = COALESCE($3, permissions)
         WHERE id = $4
         RETURNING *`,
        [role.name, role.systemRole, role.permissions ? JSON.stringify(role.permissions) : null, id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const r = result.rows[0];
      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: typeof r.permissions === 'string' 
          ? JSON.parse(r.permissions) 
          : r.permissions,
      };
    } catch (error) {
      logger.error('Error updating role:', error);
      throw new DatabaseError('Failed to update role');
    }
  }

  async deleteRole(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM roles WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting role:', error);
      throw new DatabaseError('Failed to delete role');
    }
  }

  // ===== Settings Operations =====
  async getSettings(): Promise<any | null> {
    try {
      const result = await this.pool.query('SELECT * FROM settings WHERE id = 1');

      if (result.rows.length === 0) {
        return null;
      }

      const s = result.rows[0];
      return {
        taxRateDefault: s.tax_rate_default ? parseFloat(s.tax_rate_default) : 0,
        storeName: s.store_name,
        storeEmail: s.store_email,
        storePhone: s.store_phone,
        timezone: s.timezone,
        logoUrl: s.logo_url,
        iconUrl: s.icon_url,
        brandColor: s.brand_color,
        config: s.config || {},
      };
    } catch (error) {
      logger.error('Error getting settings:', error);
      throw new DatabaseError('Failed to get settings');
    }
  }

  async updateSettings(settings: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO settings (id, tax_rate_default, store_name, store_email, store_phone, timezone, logo_url, icon_url, brand_color, config)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           tax_rate_default = COALESCE($1, settings.tax_rate_default),
           store_name = COALESCE($2, settings.store_name),
           store_email = COALESCE($3, settings.store_email),
           store_phone = COALESCE($4, settings.store_phone),
           timezone = COALESCE($5, settings.timezone),
           logo_url = COALESCE($6, settings.logo_url),
           icon_url = COALESCE($7, settings.icon_url),
           brand_color = COALESCE($8, settings.brand_color),
           config = COALESCE($9, settings.config)
         RETURNING *`,
        [
          settings.taxRateDefault,
          settings.storeName,
          settings.storeEmail,
          settings.storePhone,
          settings.timezone,
          settings.logoUrl,
          settings.iconUrl,
          settings.brandColor,
          settings.config ? JSON.stringify(settings.config) : null,
        ]
      );

      const s = result.rows[0];
      return {
        taxRateDefault: s.tax_rate_default ? parseFloat(s.tax_rate_default) : 0,
        storeName: s.store_name,
        storeEmail: s.store_email,
        storePhone: s.store_phone,
        timezone: s.timezone,
        logoUrl: s.logo_url,
        iconUrl: s.icon_url,
        brandColor: s.brand_color,
        config: s.config || {},
      };
    } catch (error) {
      logger.error('Error updating settings:', error);
      throw new DatabaseError('Failed to update settings');
    }
  }

  // ===== Audit Log Operations =====
  async createAuditLog(log: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, before, after)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          log.userId,
          log.action,
          log.entity,
          log.entityId,
          log.before ? JSON.stringify(log.before) : null,
          log.after ? JSON.stringify(log.after) : null,
        ]
      );

      const l = result.rows[0];
      return {
        id: l.id,
        timestamp: new Date(l.timestamp).getTime(),
        userId: l.user_id,
        action: l.action,
        entity: l.entity,
        entityId: l.entity_id,
        before: l.before,
        after: l.after,
      };
    } catch (error) {
      logger.error('Error creating audit log:', error);
      throw new DatabaseError('Failed to create audit log');
    }
  }

  async getAuditLogs(options?: { limit?: number; offset?: number; userId?: string }): Promise<any[]> {
    try {
      let query = `
        SELECT al.*, u.name as user_name, u.email as user_email
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (options?.userId) {
        query += ` WHERE al.user_id = $${paramIndex++}`;
        params.push(options.userId);
      }

      query += ' ORDER BY al.timestamp DESC';

      if (options?.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await this.pool.query(query, params);

      return result.rows.map((l) => ({
        id: l.id,
        timestamp: new Date(l.timestamp).getTime(),
        userId: l.user_id,
        userName: l.user_name,
        userEmail: l.user_email,
        action: l.action,
        entity: l.entity,
        entityId: l.entity_id,
        before: l.before,
        after: l.after,
      }));
    } catch (error) {
      logger.error('Error getting audit logs:', error);
      throw new DatabaseError('Failed to get audit logs');
    }
  }

  // ===== Quote Operations =====
  async getAllQuotes(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT q.*, c.name as customer_name, c.email as customer_email
         FROM quotes q
         LEFT JOIN customers c ON q.customer_id = c.id
         ORDER BY q.created_at DESC`
      );

      // Get all quote items
      const quoteIds = result.rows.map(q => q.id);
      let itemsMap = new Map<string, any[]>();

      if (quoteIds.length > 0) {
        const itemsResult = await this.pool.query(
          `SELECT qi.*, s.name as service_name
           FROM quote_items qi
           LEFT JOIN services s ON qi.service_id = s.id
           WHERE qi.quote_id = ANY($1::uuid[])`,
          [quoteIds]
        );

        itemsResult.rows.forEach((item) => {
          const quoteId = item.quote_id;
          if (!itemsMap.has(quoteId)) {
            itemsMap.set(quoteId, []);
          }
          itemsMap.get(quoteId)!.push({
            id: item.id,
            quoteId: item.quote_id,
            serviceId: item.service_id,
            serviceName: item.service_name,
            description: item.description,
            quantity: parseFloat(item.quantity),
            unitPrice: parseFloat(item.unit_price),
            lineTotal: parseFloat(item.line_total),
          });
        });
      }

      return result.rows.map((q) => ({
        id: q.id,
        customerId: q.customer_id,
        customerName: q.customer_name,
        customerEmail: q.customer_email,
        status: q.status,
        subtotal: parseFloat(q.subtotal),
        taxTotal: parseFloat(q.tax_total),
        total: parseFloat(q.total),
        notes: q.notes,
        createdAt: new Date(q.created_at).getTime(),
        expiresAt: q.expires_at ? new Date(q.expires_at).getTime() : null,
        items: itemsMap.get(q.id) || [],
      }));
    } catch (error) {
      logger.error('Error getting all quotes:', error);
      throw new DatabaseError('Failed to get quotes');
    }
  }

  async getQuoteById(id: string): Promise<any | null> {
    try {
      const quoteResult = await this.pool.query(
        `SELECT q.*, c.name as customer_name, c.email as customer_email
         FROM quotes q
         LEFT JOIN customers c ON q.customer_id = c.id
         WHERE q.id = $1`,
        [id]
      );

      if (quoteResult.rows.length === 0) {
        return null;
      }

      const q = quoteResult.rows[0];

      const itemsResult = await this.pool.query(
        `SELECT qi.*, s.name as service_name
         FROM quote_items qi
         LEFT JOIN services s ON qi.service_id = s.id
         WHERE qi.quote_id = $1`,
        [id]
      );

      return {
        id: q.id,
        customerId: q.customer_id,
        customerName: q.customer_name,
        customerEmail: q.customer_email,
        status: q.status,
        subtotal: parseFloat(q.subtotal),
        taxTotal: parseFloat(q.tax_total),
        total: parseFloat(q.total),
        notes: q.notes,
        createdAt: new Date(q.created_at).getTime(),
        expiresAt: q.expires_at ? new Date(q.expires_at).getTime() : null,
        items: itemsResult.rows.map((item) => ({
          id: item.id,
          quoteId: item.quote_id,
          serviceId: item.service_id,
          serviceName: item.service_name,
          description: item.description,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unit_price),
          lineTotal: parseFloat(item.line_total),
        })),
      };
    } catch (error) {
      logger.error('Error getting quote by ID:', error);
      throw new DatabaseError('Failed to get quote');
    }
  }

  async getQuotesByCustomer(customerId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT q.*, c.name as customer_name, c.email as customer_email
         FROM quotes q
         LEFT JOIN customers c ON q.customer_id = c.id
         WHERE q.customer_id = $1
         ORDER BY q.created_at DESC`,
        [customerId]
      );

      // Get items for these quotes
      const quoteIds = result.rows.map(q => q.id);
      let itemsMap = new Map<string, any[]>();

      if (quoteIds.length > 0) {
        const itemsResult = await this.pool.query(
          `SELECT qi.*, s.name as service_name
           FROM quote_items qi
           LEFT JOIN services s ON qi.service_id = s.id
           WHERE qi.quote_id = ANY($1::uuid[])`,
          [quoteIds]
        );

        itemsResult.rows.forEach((item) => {
          const quoteId = item.quote_id;
          if (!itemsMap.has(quoteId)) {
            itemsMap.set(quoteId, []);
          }
          itemsMap.get(quoteId)!.push({
            id: item.id,
            quoteId: item.quote_id,
            serviceId: item.service_id,
            serviceName: item.service_name,
            description: item.description,
            quantity: parseFloat(item.quantity),
            unitPrice: parseFloat(item.unit_price),
            lineTotal: parseFloat(item.line_total),
          });
        });
      }

      return result.rows.map((q) => ({
        id: q.id,
        customerId: q.customer_id,
        customerName: q.customer_name,
        customerEmail: q.customer_email,
        status: q.status,
        subtotal: parseFloat(q.subtotal),
        taxTotal: parseFloat(q.tax_total),
        total: parseFloat(q.total),
        notes: q.notes,
        createdAt: new Date(q.created_at).getTime(),
        expiresAt: q.expires_at ? new Date(q.expires_at).getTime() : null,
        items: itemsMap.get(q.id) || [],
      }));
    } catch (error) {
      logger.error('Error getting quotes by customer:', error);
      throw new DatabaseError('Failed to get quotes');
    }
  }

  async createQuote(quote: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const quoteResult = await client.query(
        `INSERT INTO quotes (customer_id, status, subtotal, tax_total, total, notes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          quote.customerId,
          quote.status || 'draft',
          quote.subtotal,
          quote.taxTotal || 0,
          quote.total,
          quote.notes,
          quote.expiresAt ? new Date(quote.expiresAt) : null,
        ]
      );

      const newQuote = quoteResult.rows[0];
      const items = [];

      if (quote.items && quote.items.length > 0) {
        for (const item of quote.items) {
          const itemResult = await client.query(
            `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              newQuote.id,
              item.serviceId,
              item.description,
              item.quantity,
              item.unitPrice,
              item.lineTotal,
            ]
          );
          items.push({
            id: itemResult.rows[0].id,
            quoteId: newQuote.id,
            serviceId: itemResult.rows[0].service_id,
            description: itemResult.rows[0].description,
            quantity: parseFloat(itemResult.rows[0].quantity),
            unitPrice: parseFloat(itemResult.rows[0].unit_price),
            lineTotal: parseFloat(itemResult.rows[0].line_total),
          });
        }
      }

      await client.query('COMMIT');

      return {
        id: newQuote.id,
        customerId: newQuote.customer_id,
        status: newQuote.status,
        subtotal: parseFloat(newQuote.subtotal),
        taxTotal: parseFloat(newQuote.tax_total),
        total: parseFloat(newQuote.total),
        notes: newQuote.notes,
        createdAt: new Date(newQuote.created_at).getTime(),
        expiresAt: newQuote.expires_at ? new Date(newQuote.expires_at).getTime() : null,
        items,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating quote:', error);
      throw new DatabaseError('Failed to create quote');
    } finally {
      client.release();
    }
  }

  async updateQuote(id: string, quote: any): Promise<any | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE quotes SET
           customer_id = COALESCE($1, customer_id),
           status = COALESCE($2, status),
           subtotal = COALESCE($3, subtotal),
           tax_total = COALESCE($4, tax_total),
           total = COALESCE($5, total),
           notes = COALESCE($6, notes),
           expires_at = COALESCE($7, expires_at)
         WHERE id = $8
         RETURNING *`,
        [
          quote.customerId,
          quote.status,
          quote.subtotal,
          quote.taxTotal,
          quote.total,
          quote.notes,
          quote.expiresAt ? new Date(quote.expiresAt) : null,
          id,
        ]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Update items if provided
      if (quote.items) {
        await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);
        for (const item of quote.items) {
          await client.query(
            `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, item.serviceId, item.description, item.quantity, item.unitPrice, item.lineTotal]
          );
        }
      }

      await client.query('COMMIT');

      return this.getQuoteById(id);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating quote:', error);
      throw new DatabaseError('Failed to update quote');
    } finally {
      client.release();
    }
  }

  async updateQuoteStatus(id: string, status: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE quotes SET status = $1 WHERE id = $2 RETURNING *`,
        [status, id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.getQuoteById(id);
    } catch (error) {
      logger.error('Error updating quote status:', error);
      throw new DatabaseError('Failed to update quote status');
    }
  }

  async deleteQuote(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM quotes WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting quote:', error);
      throw new DatabaseError('Failed to delete quote');
    }
  }

  // ===== Order Operations Extended =====
  async getOrdersByCustomerEmail(email: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM orders WHERE customer_email = $1 ORDER BY created_at DESC`,
        [email]
      );

      const orderIds = result.rows.map(o => o.id);
      let itemsMap = new Map<string, any[]>();

      if (orderIds.length > 0) {
        const itemsResult = await this.pool.query(
          `SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])`,
          [orderIds]
        );

        itemsResult.rows.forEach((item) => {
          const orderId = item.order_id;
          if (!itemsMap.has(orderId)) {
            itemsMap.set(orderId, []);
          }
          itemsMap.get(orderId)!.push({
            id: item.id,
            orderId: item.order_id,
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
          });
        });
      }

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
        items: itemsMap.get(order.id) || [],
      }));
    } catch (error) {
      logger.error('Error getting orders by customer email:', error);
      throw new DatabaseError('Failed to get orders');
    }
  }

  // ===== API Key Operations =====
  async getAllApiKeys(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT ak.*, u.name as created_by_name, u.email as created_by_email
         FROM api_keys ak
         LEFT JOIN users u ON ak.created_by = u.id
         ORDER BY ak.created_at DESC`
      );

      return result.rows.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: k.scopes || ['read'],
        rateLimit: k.rate_limit,
        isActive: k.is_active,
        lastUsedAt: k.last_used_at ? new Date(k.last_used_at).getTime() : null,
        expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null,
        createdBy: k.created_by,
        createdByName: k.created_by_name,
        createdByEmail: k.created_by_email,
        createdAt: new Date(k.created_at).getTime(),
        updatedAt: new Date(k.updated_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all API keys:', error);
      throw new DatabaseError('Failed to get API keys');
    }
  }

  async getApiKeyById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `SELECT ak.*, u.name as created_by_name, u.email as created_by_email
         FROM api_keys ak
         LEFT JOIN users u ON ak.created_by = u.id
         WHERE ak.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const k = result.rows[0];
      return {
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: k.scopes || ['read'],
        rateLimit: k.rate_limit,
        isActive: k.is_active,
        lastUsedAt: k.last_used_at ? new Date(k.last_used_at).getTime() : null,
        expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null,
        createdBy: k.created_by,
        createdByName: k.created_by_name,
        createdByEmail: k.created_by_email,
        createdAt: new Date(k.created_at).getTime(),
        updatedAt: new Date(k.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('Error getting API key by ID:', error);
      throw new DatabaseError('Failed to get API key');
    }
  }

  async getApiKeyByPrefix(prefix: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = true`,
        [prefix]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const k = result.rows[0];
      return {
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: k.scopes || ['read'],
        rateLimit: k.rate_limit,
        isActive: k.is_active,
        expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null,
      };
    } catch (error) {
      logger.error('Error getting API key by prefix:', error);
      throw new DatabaseError('Failed to get API key');
    }
  }

  async createApiKey(apiKey: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO api_keys (name, description, key_prefix, key_hash, scopes, rate_limit, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          apiKey.name,
          apiKey.description,
          apiKey.keyPrefix,
          apiKey.keyHash,
          JSON.stringify(apiKey.scopes || ['read']),
          apiKey.rateLimit || 1000,
          apiKey.expiresAt ? new Date(apiKey.expiresAt) : null,
          apiKey.createdBy,
        ]
      );

      const k = result.rows[0];
      return {
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: k.key_prefix,
        scopes: k.scopes || ['read'],
        rateLimit: k.rate_limit,
        isActive: k.is_active,
        expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null,
        createdBy: k.created_by,
        createdAt: new Date(k.created_at).getTime(),
      };
    } catch (error) {
      logger.error('Error creating API key:', error);
      throw new DatabaseError('Failed to create API key');
    }
  }

  async updateApiKey(id: string, apiKey: any): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE api_keys SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           scopes = COALESCE($3, scopes),
           rate_limit = COALESCE($4, rate_limit),
           is_active = COALESCE($5, is_active),
           expires_at = COALESCE($6, expires_at),
           updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [
          apiKey.name,
          apiKey.description,
          apiKey.scopes ? JSON.stringify(apiKey.scopes) : null,
          apiKey.rateLimit,
          apiKey.isActive,
          apiKey.expiresAt ? new Date(apiKey.expiresAt) : null,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.getApiKeyById(id);
    } catch (error) {
      logger.error('Error updating API key:', error);
      throw new DatabaseError('Failed to update API key');
    }
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
        [id]
      );
    } catch (error) {
      logger.error('Error updating API key last used:', error);
    }
  }

  async deleteApiKey(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM api_keys WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting API key:', error);
      throw new DatabaseError('Failed to delete API key');
    }
  }

  // ===== Returns & Refunds Operations =====

  async getAllReturns(filters?: { status?: string; startDate?: number; endDate?: number; customerId?: string }): Promise<any[]> {
    try {
      let query = `
        SELECT r.*, 
               o.total as original_order_total,
               u.name as created_by_name,
               c.name as customer_name
        FROM returns r
        LEFT JOIN orders o ON r.original_order_id = o.id
        LEFT JOIN users u ON r.created_by = u.id
        LEFT JOIN customers c ON r.customer_id = c.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.status) {
        query += ` AND r.status = $${paramIndex++}`;
        params.push(filters.status);
      }
      if (filters?.startDate) {
        query += ` AND r.created_at >= to_timestamp($${paramIndex++} / 1000.0)`;
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        query += ` AND r.created_at <= to_timestamp($${paramIndex++} / 1000.0)`;
        params.push(filters.endDate);
      }
      if (filters?.customerId) {
        query += ` AND r.customer_id = $${paramIndex++}`;
        params.push(filters.customerId);
      }

      query += ' ORDER BY r.created_at DESC';

      const result = await this.pool.query(query, params);

      return result.rows.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting all returns:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async getReturnById(id: string): Promise<any | null> {
    try {
      const returnResult = await this.pool.query(
        `SELECT r.*, 
                o.total as original_order_total,
                u.name as created_by_name,
                a.name as approved_by_name,
                c.name as customer_name
         FROM returns r
         LEFT JOIN orders o ON r.original_order_id = o.id
         LEFT JOIN users u ON r.created_by = u.id
         LEFT JOIN users a ON r.approved_by = a.id
         LEFT JOIN customers c ON r.customer_id = c.id
         WHERE r.id = $1`,
        [id]
      );

      if (returnResult.rows.length === 0) {
        return null;
      }

      // Get return items
      const itemsResult = await this.pool.query(
        'SELECT * FROM return_items WHERE return_id = $1',
        [id]
      );

      const returnData = this.mapReturnRow(returnResult.rows[0]);
      returnData.items = itemsResult.rows.map(item => ({
        id: item.id,
        returnId: item.return_id,
        originalOrderItemId: item.original_order_item_id,
        productId: item.product_id,
        variantId: item.variant_id,
        nameSnapshot: item.name_snapshot,
        size: item.size,
        color: item.color,
        originalQuantity: item.original_quantity,
        returnQuantity: item.return_quantity,
        unitPrice: parseFloat(item.unit_price),
        lineTotal: parseFloat(item.line_total),
        condition: item.condition,
        restocked: item.restocked,
        restockedAt: item.restocked_at ? new Date(item.restocked_at).getTime() : null,
        notes: item.notes,
      }));

      return returnData;
    } catch (error) {
      logger.error('Error getting return by ID:', error);
      throw new DatabaseError('Failed to get return');
    }
  }

  async getReturnsByOrder(orderId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT r.*, u.name as created_by_name
         FROM returns r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.original_order_id = $1
         ORDER BY r.created_at DESC`,
        [orderId]
      );

      const returns = result.rows.map(r => this.mapReturnRow(r));

      // Get items for each return
      for (const ret of returns) {
        const itemsResult = await this.pool.query(
          'SELECT * FROM return_items WHERE return_id = $1',
          [ret.id]
        );
        ret.items = itemsResult.rows.map(item => ({
          id: item.id,
          productId: item.product_id,
          nameSnapshot: item.name_snapshot,
          returnQuantity: item.return_quantity,
          lineTotal: parseFloat(item.line_total),
        }));
      }

      return returns;
    } catch (error) {
      logger.error('Error getting returns by order:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async getReturnsByCustomer(customerId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT r.*, o.total as original_order_total
         FROM returns r
         LEFT JOIN orders o ON r.original_order_id = o.id
         WHERE r.customer_id = $1
         ORDER BY r.created_at DESC`,
        [customerId]
      );

      return result.rows.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting returns by customer:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async createReturn(returnData: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert return
      const returnResult = await client.query(
        `INSERT INTO returns (
          original_order_id, return_number, return_type, status,
          customer_email, customer_phone, customer_id,
          subtotal, tax_total, total,
          refund_method, refund_status,
          reason_code, reason_details, internal_notes,
          restock_items, restocking_fee, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *`,
        [
          returnData.originalOrderId,
          returnData.returnNumber,
          returnData.returnType || 'return',
          returnData.status || 'pending',
          returnData.customerEmail,
          returnData.customerPhone,
          returnData.customerId,
          returnData.subtotal,
          returnData.taxTotal || 0,
          returnData.total,
          returnData.refundMethod,
          returnData.refundStatus || 'pending',
          returnData.reasonCode,
          returnData.reasonDetails,
          returnData.internalNotes,
          returnData.restockItems !== false,
          returnData.restockingFee || 0,
          returnData.createdBy,
        ]
      );

      const returnId = returnResult.rows[0].id;

      // Insert return items
      for (const item of returnData.items || []) {
        await client.query(
          `INSERT INTO return_items (
            return_id, original_order_item_id, product_id, variant_id,
            name_snapshot, size, color,
            original_quantity, return_quantity,
            unit_price, line_total, condition, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            returnId,
            item.originalOrderItemId,
            item.productId,
            item.variantId,
            item.nameSnapshot,
            item.size,
            item.color,
            item.originalQuantity,
            item.returnQuantity,
            item.unitPrice,
            item.lineTotal,
            item.condition || 'good',
            item.notes,
          ]
        );
      }

      await client.query('COMMIT');

      return this.getReturnById(returnId);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating return:', error);
      throw new DatabaseError('Failed to create return');
    } finally {
      client.release();
    }
  }

  async updateReturnStatus(id: string, data: { status: string; internalNotes?: string; approvedBy?: string }): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE returns SET
          status = $1,
          internal_notes = COALESCE($2, internal_notes),
          approved_by = COALESCE($3, approved_by),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
        [data.status, data.internalNotes, data.approvedBy, id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.getReturnById(id);
    } catch (error) {
      logger.error('Error updating return status:', error);
      throw new DatabaseError('Failed to update return status');
    }
  }

  async updateReturnRefundStatus(id: string, data: any): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `UPDATE returns SET
          refund_status = COALESCE($1, refund_status),
          refund_method = COALESCE($2, refund_method),
          refund_processed_at = COALESCE(to_timestamp($3 / 1000.0), refund_processed_at),
          store_credit_code = COALESCE($4, store_credit_code),
          store_credit_amount = COALESCE($5, store_credit_amount),
          updated_at = NOW()
        WHERE id = $6
        RETURNING *`,
        [
          data.refundStatus,
          data.refundMethod,
          data.refundProcessedAt,
          data.storeCreditCode,
          data.storeCreditAmount,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.getReturnById(id);
    } catch (error) {
      logger.error('Error updating return refund status:', error);
      throw new DatabaseError('Failed to update return refund status');
    }
  }

  async getReturnStats(filters?: { startDate?: number; endDate?: number }): Promise<any> {
    try {
      let whereClause = '';
      const params: any[] = [];

      if (filters?.startDate) {
        whereClause += ' AND created_at >= to_timestamp($1 / 1000.0)';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        whereClause += ` AND created_at <= to_timestamp($${params.length + 1} / 1000.0)`;
        params.push(filters.endDate);
      }

      const result = await this.pool.query(
        `SELECT
          COUNT(*) as total_returns,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_returns,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_returns,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_returns,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) as total_refunded,
          COALESCE(SUM(CASE WHEN refund_method = 'store_credit' THEN store_credit_amount ELSE 0 END), 0) as total_store_credits,
          COUNT(DISTINCT customer_id) as unique_customers
        FROM returns
        WHERE 1=1 ${whereClause}`,
        params
      );

      const stats = result.rows[0];
      return {
        totalReturns: parseInt(stats.total_returns),
        completedReturns: parseInt(stats.completed_returns),
        pendingReturns: parseInt(stats.pending_returns),
        rejectedReturns: parseInt(stats.rejected_returns),
        totalRefunded: parseFloat(stats.total_refunded),
        totalStoreCredits: parseFloat(stats.total_store_credits),
        uniqueCustomers: parseInt(stats.unique_customers),
      };
    } catch (error) {
      logger.error('Error getting return stats:', error);
      throw new DatabaseError('Failed to get return stats');
    }
  }

  async createRefundTransaction(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO refund_transactions (
          return_id, order_id, transaction_type, amount, currency,
          payment_method, processor_transaction_id, status, processed_by, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING *`,
        [
          data.returnId,
          data.orderId,
          data.transactionType,
          data.amount,
          data.currency || 'USD',
          data.paymentMethod,
          data.processorTransactionId,
          data.status || 'completed',
          data.processedBy,
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating refund transaction:', error);
      throw new DatabaseError('Failed to create refund transaction');
    }
  }

  async createStoreCredit(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO store_credits (
          customer_id, customer_email, return_id, code,
          original_amount, remaining_amount, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
        RETURNING *`,
        [
          data.customerId,
          data.customerEmail,
          data.returnId,
          data.code,
          data.originalAmount,
          data.remainingAmount,
          data.status || 'active',
          data.expiresAt,
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating store credit:', error);
      throw new DatabaseError('Failed to create store credit');
    }
  }

  async restockReturnItems(returnId: string, itemIds?: string[]): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get items to restock
      let query = 'SELECT * FROM return_items WHERE return_id = $1 AND restocked = false';
      const params: any[] = [returnId];

      if (itemIds && itemIds.length > 0) {
        query += ' AND id = ANY($2)';
        params.push(itemIds);
      }

      const itemsResult = await client.query(query, params);
      const restockedItems: any[] = [];

      for (const item of itemsResult.rows) {
        // Update stock in product_variants
        if (item.variant_id) {
          await client.query(
            'UPDATE product_variants SET stock = stock + $1 WHERE id = $2',
            [item.return_quantity, item.variant_id]
          );
        }

        // Mark item as restocked
        await client.query(
          'UPDATE return_items SET restocked = true, restocked_at = NOW() WHERE id = $1',
          [item.id]
        );

        restockedItems.push({
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          nameSnapshot: item.name_snapshot,
          quantity: item.return_quantity,
        });
      }

      await client.query('COMMIT');
      return restockedItems;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error restocking return items:', error);
      throw new DatabaseError('Failed to restock items');
    } finally {
      client.release();
    }
  }

  // Receipt email logging
  async logReceiptEmail(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO receipt_emails (
          order_id, return_id, recipient_email, subject, receipt_type, status, sent_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          data.orderId,
          data.returnId,
          data.recipientEmail,
          data.subject,
          data.receiptType,
          data.status || 'sent',
          data.sentBy,
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error logging receipt email:', error);
      throw new DatabaseError('Failed to log receipt email');
    }
  }

  async getReceiptEmailHistory(orderId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT re.*, u.name as sent_by_name
         FROM receipt_emails re
         LEFT JOIN users u ON re.sent_by = u.id
         WHERE re.order_id = $1
         ORDER BY re.sent_at DESC`,
        [orderId]
      );

      return result.rows.map(r => ({
        id: r.id,
        orderId: r.order_id,
        recipientEmail: r.recipient_email,
        subject: r.subject,
        receiptType: r.receipt_type,
        status: r.status,
        sentBy: r.sent_by,
        sentByName: r.sent_by_name,
        sentAt: new Date(r.sent_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting receipt email history:', error);
      throw new DatabaseError('Failed to get receipt email history');
    }
  }

  async searchOrders(filters: any): Promise<any[]> {
    try {
      let query = `
        SELECT o.*, 
               COUNT(oi.id) as item_count
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters.query) {
        query += ` AND (o.id::text ILIKE $${paramIndex} OR o.customer_email ILIKE $${paramIndex})`;
        params.push(`%${filters.query}%`);
        paramIndex++;
      }
      if (filters.startDate) {
        query += ` AND o.created_at >= to_timestamp($${paramIndex++} / 1000.0)`;
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ` AND o.created_at <= to_timestamp($${paramIndex++} / 1000.0)`;
        params.push(filters.endDate);
      }
      if (filters.customerEmail) {
        query += ` AND o.customer_email = $${paramIndex++}`;
        params.push(filters.customerEmail);
      }
      if (filters.minAmount !== undefined) {
        query += ` AND o.total >= $${paramIndex++}`;
        params.push(filters.minAmount);
      }
      if (filters.maxAmount !== undefined) {
        query += ` AND o.total <= $${paramIndex++}`;
        params.push(filters.maxAmount);
      }
      if (filters.paymentMethod) {
        query += ` AND o.payment_method = $${paramIndex++}`;
        params.push(filters.paymentMethod);
      }

      query += ' GROUP BY o.id ORDER BY o.created_at DESC';

      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }
      if (filters.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(filters.offset);
      }

      const result = await this.pool.query(query, params);

      return result.rows.map(order => ({
        id: order.id,
        createdAt: new Date(order.created_at).getTime(),
        subtotal: parseFloat(order.subtotal),
        discountTotal: parseFloat(order.discount_total),
        taxTotal: parseFloat(order.tax_total),
        total: parseFloat(order.total),
        paymentMethod: order.payment_method,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        itemCount: parseInt(order.item_count),
      }));
    } catch (error) {
      logger.error('Error searching orders:', error);
      throw new DatabaseError('Failed to search orders');
    }
  }

  private mapReturnRow(row: any): any {
    return {
      id: row.id,
      originalOrderId: row.original_order_id,
      returnNumber: row.return_number,
      returnType: row.return_type,
      status: row.status,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      customerId: row.customer_id,
      customerName: row.customer_name,
      subtotal: parseFloat(row.subtotal),
      taxTotal: parseFloat(row.tax_total),
      total: parseFloat(row.total),
      refundMethod: row.refund_method,
      refundStatus: row.refund_status,
      refundProcessedAt: row.refund_processed_at ? new Date(row.refund_processed_at).getTime() : null,
      refundReference: row.refund_reference,
      storeCreditAmount: row.store_credit_amount ? parseFloat(row.store_credit_amount) : 0,
      storeCreditCode: row.store_credit_code,
      reasonCode: row.reason_code,
      reasonDetails: row.reason_details,
      internalNotes: row.internal_notes,
      restockItems: row.restock_items,
      restockingFee: row.restocking_fee ? parseFloat(row.restocking_fee) : 0,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by_name,
      originalOrderTotal: row.original_order_total ? parseFloat(row.original_order_total) : null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===== Discount Types Operations =====
  
  async getAllDiscountTypes(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM discount_types ORDER BY display_order, name'
      );
      return result.rows.map(r => this.mapDiscountTypeRow(r));
    } catch (error) {
      logger.error('Error getting discount types:', error);
      throw new DatabaseError('Failed to get discount types');
    }
  }

  async getDiscountTypesForPOS(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM discount_types WHERE is_active = true AND show_in_pos = true ORDER BY display_order, name'
      );
      return result.rows.map(r => this.mapDiscountTypeRow(r));
    } catch (error) {
      logger.error('Error getting POS discount types:', error);
      throw new DatabaseError('Failed to get discount types');
    }
  }

  async getDiscountTypeById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query('SELECT * FROM discount_types WHERE id = $1', [id]);
      return result.rows[0] ? this.mapDiscountTypeRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting discount type:', error);
      throw new DatabaseError('Failed to get discount type');
    }
  }

  async createDiscountType(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO discount_types (
          name, description, code, discount_type, discount_value,
          min_purchase, max_discount, applies_to, applicable_ids,
          requires_approval, approval_threshold, requires_employee_id,
          display_order, color, icon, show_in_pos, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *`,
        [
          data.name, data.description, data.code, data.discountType, data.discountValue,
          data.minPurchase || 0, data.maxDiscount, data.appliesTo || 'all', data.applicableIds || [],
          data.requiresApproval || false, data.approvalThreshold, data.requiresEmployeeId || false,
          data.displayOrder || 0, data.color || 'gray', data.icon, data.showInPos !== false, data.isActive !== false
        ]
      );
      return this.mapDiscountTypeRow(result.rows[0]);
    } catch (error) {
      logger.error('Error creating discount type:', error);
      throw new DatabaseError('Failed to create discount type');
    }
  }

  async updateDiscountType(id: string, data: any): Promise<any | null> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
      if (data.code !== undefined) { fields.push(`code = $${idx++}`); values.push(data.code); }
      if (data.discountType !== undefined) { fields.push(`discount_type = $${idx++}`); values.push(data.discountType); }
      if (data.discountValue !== undefined) { fields.push(`discount_value = $${idx++}`); values.push(data.discountValue); }
      if (data.minPurchase !== undefined) { fields.push(`min_purchase = $${idx++}`); values.push(data.minPurchase); }
      if (data.maxDiscount !== undefined) { fields.push(`max_discount = $${idx++}`); values.push(data.maxDiscount); }
      if (data.appliesTo !== undefined) { fields.push(`applies_to = $${idx++}`); values.push(data.appliesTo); }
      if (data.applicableIds !== undefined) { fields.push(`applicable_ids = $${idx++}`); values.push(data.applicableIds); }
      if (data.requiresApproval !== undefined) { fields.push(`requires_approval = $${idx++}`); values.push(data.requiresApproval); }
      if (data.approvalThreshold !== undefined) { fields.push(`approval_threshold = $${idx++}`); values.push(data.approvalThreshold); }
      if (data.requiresEmployeeId !== undefined) { fields.push(`requires_employee_id = $${idx++}`); values.push(data.requiresEmployeeId); }
      if (data.displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(data.displayOrder); }
      if (data.color !== undefined) { fields.push(`color = $${idx++}`); values.push(data.color); }
      if (data.icon !== undefined) { fields.push(`icon = $${idx++}`); values.push(data.icon); }
      if (data.showInPos !== undefined) { fields.push(`show_in_pos = $${idx++}`); values.push(data.showInPos); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }

      if (fields.length === 0) return this.getDiscountTypeById(id);

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await this.pool.query(
        `UPDATE discount_types SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return result.rows[0] ? this.mapDiscountTypeRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating discount type:', error);
      throw new DatabaseError('Failed to update discount type');
    }
  }

  async deleteDiscountType(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM discount_types WHERE id = $1 RETURNING id', [id]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting discount type:', error);
      throw new DatabaseError('Failed to delete discount type');
    }
  }

  private mapDiscountTypeRow(row: any): any {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      code: row.code,
      discountType: row.discount_type,
      discountValue: parseFloat(row.discount_value),
      minPurchase: parseFloat(row.min_purchase || 0),
      maxDiscount: row.max_discount ? parseFloat(row.max_discount) : null,
      appliesTo: row.applies_to,
      applicableIds: row.applicable_ids || [],
      requiresApproval: row.requires_approval,
      approvalThreshold: row.approval_threshold ? parseFloat(row.approval_threshold) : null,
      requiresEmployeeId: row.requires_employee_id,
      displayOrder: row.display_order,
      color: row.color,
      icon: row.icon,
      showInPos: row.show_in_pos,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===== Promo Codes Operations =====

  async getAllPromoCodes(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT pc.*, u.name as created_by_name FROM promo_codes pc LEFT JOIN users u ON pc.created_by = u.id ORDER BY pc.created_at DESC'
      );
      return result.rows.map(r => this.mapPromoCodeRow(r));
    } catch (error) {
      logger.error('Error getting promo codes:', error);
      throw new DatabaseError('Failed to get promo codes');
    }
  }

  async getPromoCodeById(id: string): Promise<any | null> {
    try {
      const result = await this.pool.query('SELECT * FROM promo_codes WHERE id = $1', [id]);
      return result.rows[0] ? this.mapPromoCodeRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting promo code:', error);
      throw new DatabaseError('Failed to get promo code');
    }
  }

  async getPromoCodeByCode(code: string): Promise<any | null> {
    try {
      const result = await this.pool.query('SELECT * FROM promo_codes WHERE UPPER(code) = $1', [code.toUpperCase()]);
      return result.rows[0] ? this.mapPromoCodeRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting promo code by code:', error);
      throw new DatabaseError('Failed to get promo code');
    }
  }

  async createPromoCode(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO promo_codes (
          code, name, description, discount_type, discount_value,
          buy_quantity, get_quantity, get_product_id,
          min_purchase, max_discount, min_items,
          applies_to, applicable_ids, excluded_ids,
          first_order_only, specific_customers, customer_groups,
          max_uses, max_uses_per_customer,
          starts_at, expires_at, stackable, priority, is_active, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        RETURNING *`,
        [
          data.code.toUpperCase(), data.name, data.description, data.discountType, data.discountValue,
          data.buyQuantity, data.getQuantity, data.getProductId,
          data.minPurchase || 0, data.maxDiscount, data.minItems || 0,
          data.appliesTo || 'all', data.applicableIds || [], data.excludedIds || [],
          data.firstOrderOnly || false, data.specificCustomers || [], data.customerGroups || [],
          data.maxUses, data.maxUsesPerCustomer || 1,
          new Date(data.startsAt), data.expiresAt ? new Date(data.expiresAt) : null,
          data.stackable || false, data.priority || 0, data.isActive !== false, data.createdBy
        ]
      );
      return this.mapPromoCodeRow(result.rows[0]);
    } catch (error) {
      logger.error('Error creating promo code:', error);
      throw new DatabaseError('Failed to create promo code');
    }
  }

  async updatePromoCode(id: string, data: any): Promise<any | null> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (data.code !== undefined) { fields.push(`code = $${idx++}`); values.push(data.code.toUpperCase()); }
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
      if (data.discountType !== undefined) { fields.push(`discount_type = $${idx++}`); values.push(data.discountType); }
      if (data.discountValue !== undefined) { fields.push(`discount_value = $${idx++}`); values.push(data.discountValue); }
      if (data.minPurchase !== undefined) { fields.push(`min_purchase = $${idx++}`); values.push(data.minPurchase); }
      if (data.maxDiscount !== undefined) { fields.push(`max_discount = $${idx++}`); values.push(data.maxDiscount); }
      if (data.maxUses !== undefined) { fields.push(`max_uses = $${idx++}`); values.push(data.maxUses); }
      if (data.maxUsesPerCustomer !== undefined) { fields.push(`max_uses_per_customer = $${idx++}`); values.push(data.maxUsesPerCustomer); }
      if (data.startsAt !== undefined) { fields.push(`starts_at = $${idx++}`); values.push(new Date(data.startsAt)); }
      if (data.expiresAt !== undefined) { fields.push(`expires_at = $${idx++}`); values.push(data.expiresAt ? new Date(data.expiresAt) : null); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
      if (data.stackable !== undefined) { fields.push(`stackable = $${idx++}`); values.push(data.stackable); }

      if (fields.length === 0) return this.getPromoCodeById(id);

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await this.pool.query(
        `UPDATE promo_codes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return result.rows[0] ? this.mapPromoCodeRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating promo code:', error);
      throw new DatabaseError('Failed to update promo code');
    }
  }

  async deletePromoCode(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM promo_codes WHERE id = $1 RETURNING id', [id]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting promo code:', error);
      throw new DatabaseError('Failed to delete promo code');
    }
  }

  async incrementPromoCodeUsage(id: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE promo_codes SET current_uses = current_uses + 1, updated_at = NOW() WHERE id = $1',
        [id]
      );
    } catch (error) {
      logger.error('Error incrementing promo code usage:', error);
    }
  }

  async getPromoCodeUsageByCustomer(promoCodeId: string, customerId: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) FROM discount_usage WHERE promo_code_id = $1 AND customer_id = $2',
        [promoCodeId, customerId]
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error getting promo code usage by customer:', error);
      return 0;
    }
  }

  private mapPromoCodeRow(row: any): any {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      discountType: row.discount_type,
      discountValue: parseFloat(row.discount_value),
      buyQuantity: row.buy_quantity,
      getQuantity: row.get_quantity,
      getProductId: row.get_product_id,
      minPurchase: parseFloat(row.min_purchase || 0),
      maxDiscount: row.max_discount ? parseFloat(row.max_discount) : null,
      minItems: row.min_items || 0,
      appliesTo: row.applies_to,
      applicableIds: row.applicable_ids || [],
      excludedIds: row.excluded_ids || [],
      firstOrderOnly: row.first_order_only,
      specificCustomers: row.specific_customers || [],
      customerGroups: row.customer_groups || [],
      maxUses: row.max_uses,
      maxUsesPerCustomer: row.max_uses_per_customer,
      currentUses: row.current_uses || 0,
      startsAt: new Date(row.starts_at).getTime(),
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
      stackable: row.stackable,
      priority: row.priority,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===== Employee Discounts Operations =====

  async getAllEmployeeDiscounts(): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT ed.*, u.name as user_name, u.email as user_email, a.name as approved_by_name
         FROM employee_discounts ed
         LEFT JOIN users u ON ed.user_id = u.id
         LEFT JOIN users a ON ed.approved_by = a.id
         ORDER BY ed.created_at DESC`
      );
      return result.rows.map(r => this.mapEmployeeDiscountRow(r));
    } catch (error) {
      logger.error('Error getting employee discounts:', error);
      throw new DatabaseError('Failed to get employee discounts');
    }
  }

  async getEmployeeDiscountByUser(userId: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `SELECT ed.*, u.name as user_name, u.email as user_email
         FROM employee_discounts ed
         LEFT JOIN users u ON ed.user_id = u.id
         WHERE ed.user_id = $1`,
        [userId]
      );
      return result.rows[0] ? this.mapEmployeeDiscountRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting employee discount:', error);
      throw new DatabaseError('Failed to get employee discount');
    }
  }

  async upsertEmployeeDiscount(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO employee_discounts (
          user_id, discount_percentage, max_discount_amount,
          requires_manager_approval_above, allowed_categories,
          is_active, approved_by, approved_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
        ON CONFLICT (user_id) DO UPDATE SET
          discount_percentage = EXCLUDED.discount_percentage,
          max_discount_amount = EXCLUDED.max_discount_amount,
          requires_manager_approval_above = EXCLUDED.requires_manager_approval_above,
          allowed_categories = EXCLUDED.allowed_categories,
          is_active = EXCLUDED.is_active,
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at,
          updated_at = NOW()
        RETURNING *`,
        [
          data.userId, data.discountPercentage || 10, data.maxDiscountAmount,
          data.requiresManagerApprovalAbove, data.allowedCategories || [],
          data.isActive !== false, data.approvedBy, data.approvedAt
        ]
      );
      return this.mapEmployeeDiscountRow(result.rows[0]);
    } catch (error) {
      logger.error('Error upserting employee discount:', error);
      throw new DatabaseError('Failed to create/update employee discount');
    }
  }

  async deleteEmployeeDiscount(userId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM employee_discounts WHERE user_id = $1 RETURNING id',
        [userId]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error deleting employee discount:', error);
      throw new DatabaseError('Failed to delete employee discount');
    }
  }

  private mapEmployeeDiscountRow(row: any): any {
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      discountPercentage: parseFloat(row.discount_percentage),
      maxDiscountAmount: row.max_discount_amount ? parseFloat(row.max_discount_amount) : null,
      currentMonthUsage: parseFloat(row.current_month_usage || 0),
      lastResetAt: row.last_reset_at ? new Date(row.last_reset_at).getTime() : null,
      requiresManagerApprovalAbove: row.requires_manager_approval_above ? parseFloat(row.requires_manager_approval_above) : null,
      allowedCategories: row.allowed_categories || [],
      isActive: row.is_active,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by_name,
      approvedAt: row.approved_at ? new Date(row.approved_at).getTime() : null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===== Discount Usage Operations =====

  async getDiscountUsage(filters?: { orderId?: string; customerId?: string; startDate?: number; endDate?: number }): Promise<any[]> {
    try {
      let query = `
        SELECT du.*, u.name as applied_by_name, a.name as approved_by_name
        FROM discount_usage du
        LEFT JOIN users u ON du.applied_by = u.id
        LEFT JOIN users a ON du.approved_by = a.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;

      if (filters?.orderId) {
        query += ` AND du.order_id = $${idx++}`;
        params.push(filters.orderId);
      }
      if (filters?.customerId) {
        query += ` AND du.customer_id = $${idx++}`;
        params.push(filters.customerId);
      }
      if (filters?.startDate) {
        query += ` AND du.applied_at >= to_timestamp($${idx++} / 1000.0)`;
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        query += ` AND du.applied_at <= to_timestamp($${idx++} / 1000.0)`;
        params.push(filters.endDate);
      }

      query += ' ORDER BY du.applied_at DESC LIMIT 500';

      const result = await this.pool.query(query, params);
      return result.rows.map(r => ({
        id: r.id,
        orderId: r.order_id,
        quoteId: r.quote_id,
        discountSource: r.discount_source,
        discountTypeId: r.discount_type_id,
        promoCodeId: r.promo_code_id,
        employeeDiscountId: r.employee_discount_id,
        discountCode: r.discount_code,
        discountName: r.discount_name,
        discountType: r.discount_type,
        discountValue: r.discount_value ? parseFloat(r.discount_value) : null,
        discountAmount: parseFloat(r.discount_amount),
        manualReason: r.manual_reason,
        customerId: r.customer_id,
        customerEmail: r.customer_email,
        requiresApproval: r.requires_approval,
        approvedBy: r.approved_by,
        approvedByName: r.approved_by_name,
        approvalStatus: r.approval_status,
        appliedBy: r.applied_by,
        appliedByName: r.applied_by_name,
        appliedAt: new Date(r.applied_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting discount usage:', error);
      throw new DatabaseError('Failed to get discount usage');
    }
  }

  async logDiscountUsage(data: any): Promise<any> {
    try {
      const result = await this.pool.query(
        `INSERT INTO discount_usage (
          order_id, quote_id, discount_source,
          discount_type_id, promo_code_id, employee_discount_id,
          discount_code, discount_name, discount_type, discount_value, discount_amount,
          manual_reason, customer_id, customer_email,
          requires_approval, approved_by, approval_status, applied_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *`,
        [
          data.orderId, data.quoteId, data.discountSource,
          data.discountTypeId, data.promoCodeId, data.employeeDiscountId,
          data.discountCode, data.discountName, data.discountType, data.discountValue, data.discountAmount,
          data.manualReason, data.customerId, data.customerEmail,
          data.requiresApproval || false, data.approvedBy, data.approvalStatus || 'none', data.appliedBy
        ]
      );
      return result.rows[0];
    } catch (error) {
      logger.error('Error logging discount usage:', error);
      throw new DatabaseError('Failed to log discount usage');
    }
  }

  async getDiscountStats(filters?: { startDate?: number; endDate?: number }): Promise<any> {
    try {
      let whereClause = '';
      const params: any[] = [];

      if (filters?.startDate) {
        whereClause += ' AND applied_at >= to_timestamp($1 / 1000.0)';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        whereClause += ` AND applied_at <= to_timestamp($${params.length + 1} / 1000.0)`;
        params.push(filters.endDate);
      }

      const result = await this.pool.query(
        `SELECT
          COUNT(*) as total_discounts,
          COALESCE(SUM(discount_amount), 0) as total_discount_amount,
          COUNT(CASE WHEN discount_source = 'promo_code' THEN 1 END) as promo_code_count,
          COALESCE(SUM(CASE WHEN discount_source = 'promo_code' THEN discount_amount ELSE 0 END), 0) as promo_code_amount,
          COUNT(CASE WHEN discount_source = 'quick_discount' THEN 1 END) as quick_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'quick_discount' THEN discount_amount ELSE 0 END), 0) as quick_discount_amount,
          COUNT(CASE WHEN discount_source = 'employee' THEN 1 END) as employee_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'employee' THEN discount_amount ELSE 0 END), 0) as employee_discount_amount,
          COUNT(CASE WHEN discount_source = 'manual' THEN 1 END) as manual_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'manual' THEN discount_amount ELSE 0 END), 0) as manual_discount_amount
        FROM discount_usage
        WHERE 1=1 ${whereClause}`,
        params
      );

      const stats = result.rows[0];
      return {
        totalDiscounts: parseInt(stats.total_discounts),
        totalDiscountAmount: parseFloat(stats.total_discount_amount),
        promoCodeCount: parseInt(stats.promo_code_count),
        promoCodeAmount: parseFloat(stats.promo_code_amount),
        quickDiscountCount: parseInt(stats.quick_discount_count),
        quickDiscountAmount: parseFloat(stats.quick_discount_amount),
        employeeDiscountCount: parseInt(stats.employee_discount_count),
        employeeDiscountAmount: parseFloat(stats.employee_discount_amount),
        manualDiscountCount: parseInt(stats.manual_discount_count),
        manualDiscountAmount: parseFloat(stats.manual_discount_amount),
      };
    } catch (error) {
      logger.error('Error getting discount stats:', error);
      throw new DatabaseError('Failed to get discount stats');
    }
  }
}
