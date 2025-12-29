import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../../utils/logger';
import { DatabaseError } from '../../utils/errors';

export interface SQLiteConfig {
  filename: string;
}

export class SQLiteAdapter {
  private db: Database.Database;

  constructor(config: SQLiteConfig) {
    // Ensure directory exists
    const dir = path.dirname(config.filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.filename);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    logger.info('SQLite adapter initialized');
  }

  async testConnection(): Promise<boolean> {
    try {
      this.db.prepare('SELECT 1 as test').get();
      logger.info('SQLite connection test successful');
      return true;
    } catch (error) {
      logger.error('SQLite connection test failed:', error);
      return false;
    }
  }

  // User Operations
  async getUserByEmail(email: string): Promise<any> {
    try {
      const user = this.db
        .prepare(
          `SELECT u.*, 
                  GROUP_CONCAT(r.id) as role_ids
           FROM users u
           LEFT JOIN user_roles ur ON u.id = ur.user_id
           LEFT JOIN roles r ON ur.role_id = r.id
           WHERE u.email = ?
           GROUP BY u.id`
        )
        .get(email) as any;

      if (!user) {
        return null;
      }

      // Get roles with permissions
      const roleIds = user.role_ids ? user.role_ids.split(',') : [];
      const roles = [];
      
      for (const roleId of roleIds) {
        const role = this.db
          .prepare('SELECT * FROM roles WHERE id = ?')
          .get(roleId) as any;
        
        if (role) {
          roles.push({
            id: role.id,
            name: role.name,
            systemRole: role.system_role,
            permissions: JSON.parse(role.permissions),
          });
        }
      }

      return {
        id: user.id,
        email: user.email,
        passwordHash: user.password_hash,
        name: user.name,
        roleIds,
        status: user.status,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        roles,
      };
    } catch (error) {
      logger.error('Error getting user by email:', error);
      throw new DatabaseError('Failed to get user');
    }
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    try {
      const now = Date.now();
      this.db
        .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
        .run(now, userId);
    } catch (error) {
      logger.error('Error updating user last login:', error);
      throw new DatabaseError('Failed to update user');
    }
  }

  // Product Operations
  async getAllProducts(): Promise<any[]> {
    try {
      const products = this.db
        .prepare('SELECT * FROM products ORDER BY name ASC')
        .all() as any[];

      // Get variants for each product
      const productsWithVariants = products.map((product) => {
        const variants = this.db
          .prepare('SELECT * FROM product_variants WHERE product_id = ?')
          .all(product.id) as any[];

        return {
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          basePrice: product.base_price,
          image: product.image,
          barcode: product.barcode,
          variants: variants.map((v) => ({
            id: v.id,
            size: v.size,
            color: v.color,
            priceOverride: v.price_override,
            priceDelta: v.price_delta,
            sku: v.sku,
            barcode: v.barcode,
            stock: v.stock,
            enabled: v.enabled === 1,
          })),
          createdAt: product.created_at,
          updatedAt: product.updated_at,
        };
      });

      return productsWithVariants;
    } catch (error) {
      logger.error('Error getting all products:', error);
      throw new DatabaseError('Failed to get products');
    }
  }

  async getProductById(id: string): Promise<any | null> {
    try {
      const product = this.db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(id) as any;

      if (!product) {
        return null;
      }

      const variants = this.db
        .prepare('SELECT * FROM product_variants WHERE product_id = ?')
        .all(id) as any[];

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        basePrice: product.base_price,
        image: product.image,
        barcode: product.barcode,
        variants: variants.map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          priceOverride: v.price_override,
          priceDelta: v.price_delta,
          sku: v.sku,
          barcode: v.barcode,
          stock: v.stock,
          enabled: v.enabled === 1,
        })),
        createdAt: product.created_at,
        updatedAt: product.updated_at,
      };
    } catch (error) {
      logger.error('Error getting product by ID:', error);
      throw new DatabaseError('Failed to get product');
    }
  }

  async createProduct(product: any): Promise<any> {
    const transaction = this.db.transaction(() => {
      // Insert product
      const now = Date.now();
      const productResult = this.db
        .prepare(
          `INSERT INTO products (name, description, category, base_price, image, barcode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          product.name,
          product.description,
          product.category,
          product.basePrice,
          product.image,
          product.barcode,
          now,
          now
        );

      const productId = productResult.lastInsertRowid as number;

      // Get the created product to get the generated ID
      const createdProduct = this.db
        .prepare('SELECT * FROM products WHERE rowid = ?')
        .get(productId) as any;

      // Insert variants if provided
      const variants = [];
      if (product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          const variantResult = this.db
            .prepare(
              `INSERT INTO product_variants 
               (product_id, size, color, price_override, price_delta, sku, barcode, stock, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              createdProduct.id,
              variant.size,
              variant.color,
              variant.priceOverride,
              variant.priceDelta,
              variant.sku,
              variant.barcode,
              variant.stock || 0,
              variant.enabled !== false ? 1 : 0
            );

          const createdVariant = this.db
            .prepare('SELECT * FROM product_variants WHERE rowid = ?')
            .get(variantResult.lastInsertRowid) as any;

          variants.push({
            id: createdVariant.id,
            size: createdVariant.size,
            color: createdVariant.color,
            priceOverride: createdVariant.price_override,
            priceDelta: createdVariant.price_delta,
            sku: createdVariant.sku,
            barcode: createdVariant.barcode,
            stock: createdVariant.stock,
            enabled: createdVariant.enabled === 1,
          });
        }
      }

      return {
        id: createdProduct.id,
        name: createdProduct.name,
        description: createdProduct.description,
        category: createdProduct.category,
        basePrice: createdProduct.base_price,
        image: createdProduct.image,
        barcode: createdProduct.barcode,
        variants,
        createdAt: createdProduct.created_at,
        updatedAt: createdProduct.updated_at,
      };
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error creating product:', error);
      throw new DatabaseError('Failed to create product');
    }
  }

  async updateProduct(id: string, product: any): Promise<any> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          `UPDATE products 
           SET name = ?, description = ?, category = ?, base_price = ?, 
               image = ?, barcode = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          product.name,
          product.description,
          product.category,
          product.basePrice,
          product.image,
          product.barcode,
          now,
          id
        );

      if (result.changes === 0) {
        return null;
      }

      const updated = this.db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(id) as any;

      return {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        category: updated.category,
        basePrice: updated.base_price,
        image: updated.image,
        barcode: updated.barcode,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    } catch (error) {
      logger.error('Error updating product:', error);
      throw new DatabaseError('Failed to update product');
    }
  }

  async deleteProduct(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM products WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting product:', error);
      throw new DatabaseError('Failed to delete product');
    }
  }

  // Order Operations
  async createOrder(order: any): Promise<any> {
    const transaction = this.db.transaction(() => {
      // Insert order
      const now = Date.now();
      const orderResult = this.db
        .prepare(
          `INSERT INTO orders (created_at, subtotal, discount_total, tax_total, total, payment_method, customer_email, customer_phone)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          now,
          order.subtotal,
          order.discountTotal || 0,
          order.taxTotal || 0,
          order.total,
          order.paymentMethod,
          order.customerEmail,
          order.customerPhone
        );

      const createdOrder = this.db
        .prepare('SELECT * FROM orders WHERE rowid = ?')
        .get(orderResult.lastInsertRowid) as any;

      // Insert order items and update stock
      const items = [];
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          const itemResult = this.db
            .prepare(
              `INSERT INTO order_items 
               (order_id, product_id, variant_id, name_snapshot, size, color, quantity, unit_price, line_discount, line_total, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              createdOrder.id,
              item.productId,
              item.variantId,
              item.nameSnapshot,
              item.size,
              item.color,
              item.quantity,
              item.unitPrice,
              item.lineDiscount || 0,
              item.lineTotal,
              item.notes
            );

          const createdItem = this.db
            .prepare('SELECT * FROM order_items WHERE rowid = ?')
            .get(itemResult.lastInsertRowid) as any;

          items.push(createdItem);

          // Update variant stock if variantId is provided
          if (item.variantId) {
            this.db
              .prepare(
                `UPDATE product_variants 
                 SET stock = MAX(0, stock - ?)
                 WHERE id = ?`
              )
              .run(item.quantity, item.variantId);
          }
        }
      }

      return {
        id: createdOrder.id,
        createdAt: createdOrder.created_at,
        subtotal: createdOrder.subtotal,
        discountTotal: createdOrder.discount_total,
        taxTotal: createdOrder.tax_total,
        total: createdOrder.total,
        paymentMethod: createdOrder.payment_method,
        customerEmail: createdOrder.customer_email,
        customerPhone: createdOrder.customer_phone,
        items,
      };
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error creating order:', error);
      throw new DatabaseError('Failed to create order');
    }
  }

  async getAllOrders(): Promise<any[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders ORDER BY created_at DESC')
        .all() as any[];

      // Get all order items
      const itemsMap = new Map<string, any[]>();
      const orderIds = orders.map(o => o.id);
      
      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        const items = this.db
          .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`)
          .all(...orderIds) as any[];
        
        // Group items by order_id
        items.forEach((item) => {
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
            unitPrice: item.unit_price,
            lineDiscount: item.line_discount,
            lineTotal: item.line_total,
            notes: item.notes,
          });
        });
      }

      return orders.map((order) => ({
        id: order.id,
        createdAt: order.created_at,
        subtotal: order.subtotal,
        discountTotal: order.discount_total,
        taxTotal: order.tax_total,
        total: order.total,
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
      const order = this.db
        .prepare('SELECT * FROM orders WHERE id = ?')
        .get(id) as any;

      if (!order) {
        return null;
      }

      const items = this.db
        .prepare('SELECT * FROM order_items WHERE order_id = ?')
        .all(id) as any[];

      return {
        id: order.id,
        createdAt: order.created_at,
        subtotal: order.subtotal,
        discountTotal: order.discount_total,
        taxTotal: order.tax_total,
        total: order.total,
        paymentMethod: order.payment_method,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        items: items.map((item) => ({
          id: item.id,
          orderId: item.order_id,
          productId: item.product_id,
          variantId: item.variant_id,
          nameSnapshot: item.name_snapshot,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          lineDiscount: item.line_discount,
          lineTotal: item.line_total,
          notes: item.notes,
        })),
      };
    } catch (error) {
      logger.error('Error getting order by ID:', error);
      throw new DatabaseError('Failed to get order');
    }
  }

  // Customer Operations
  async getAllCustomers(): Promise<any[]> {
    try {
      const customers = this.db
        .prepare('SELECT * FROM customers ORDER BY name ASC')
        .all() as any[];

      return customers.map((c) => ({
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
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));
    } catch (error) {
      logger.error('Error getting all customers:', error);
      throw new DatabaseError('Failed to get customers');
    }
  }

  async createCustomer(customer: any): Promise<any> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          `INSERT INTO customers (name, org, email, phone, address, city, state, zip, country, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
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
          now,
          now
        );

      const created = this.db
        .prepare('SELECT * FROM customers WHERE rowid = ?')
        .get(result.lastInsertRowid) as any;

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
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };
    } catch (error) {
      logger.error('Error creating customer:', error);
      throw new DatabaseError('Failed to create customer');
    }
  }

  async getCustomerById(id: string): Promise<any | null> {
    try {
      const c = this.db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(id) as any;

      if (!c) {
        return null;
      }

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
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    } catch (error) {
      logger.error('Error getting customer by ID:', error);
      throw new DatabaseError('Failed to get customer');
    }
  }

  async updateCustomer(id: string, customer: any): Promise<any | null> {
    try {
      const existing = this.db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      const now = Date.now();
      this.db
        .prepare(
          `UPDATE customers SET 
             name = COALESCE(?, name),
             org = COALESCE(?, org),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             address = COALESCE(?, address),
             city = COALESCE(?, city),
             state = COALESCE(?, state),
             zip = COALESCE(?, zip),
             country = COALESCE(?, country),
             notes = COALESCE(?, notes),
             updated_at = ?
           WHERE id = ?`
        )
        .run(
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
          now,
          id
        );

      const c = this.db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(id) as any;

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
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    } catch (error) {
      logger.error('Error updating customer:', error);
      throw new DatabaseError('Failed to update customer');
    }
  }

  async deleteCustomer(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM customers WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting customer:', error);
      throw new DatabaseError('Failed to delete customer');
    }
  }

  close(): void {
    this.db.close();
    logger.info('SQLite connection closed');
  }

  // ===== Service Operations =====
  async getAllServices(): Promise<any[]> {
    try {
      const services = this.db
        .prepare('SELECT * FROM services ORDER BY name ASC')
        .all() as any[];

      return services.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price,
        unitType: s.unit_type,
        isActive: s.is_active === 1,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));
    } catch (error) {
      logger.error('Error getting all services:', error);
      throw new DatabaseError('Failed to get services');
    }
  }

  async getServiceById(id: string): Promise<any | null> {
    try {
      const s = this.db
        .prepare('SELECT * FROM services WHERE id = ?')
        .get(id) as any;

      if (!s) {
        return null;
      }

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price,
        unitType: s.unit_type,
        isActive: s.is_active === 1,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      };
    } catch (error) {
      logger.error('Error getting service by ID:', error);
      throw new DatabaseError('Failed to get service');
    }
  }

  async createService(service: any): Promise<any> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          `INSERT INTO services (name, category, description, base_price, unit_type, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          service.name,
          service.category,
          service.description,
          service.basePrice,
          service.unitType || 'flat',
          service.isActive !== false ? 1 : 0,
          now,
          now
        );

      const s = this.db
        .prepare('SELECT * FROM services WHERE rowid = ?')
        .get(result.lastInsertRowid) as any;

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price,
        unitType: s.unit_type,
        isActive: s.is_active === 1,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      };
    } catch (error) {
      logger.error('Error creating service:', error);
      throw new DatabaseError('Failed to create service');
    }
  }

  async updateService(id: string, service: any): Promise<any | null> {
    try {
      const now = Date.now();
      const existing = this.db
        .prepare('SELECT * FROM services WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      this.db
        .prepare(
          `UPDATE services SET 
             name = COALESCE(?, name),
             category = COALESCE(?, category),
             description = COALESCE(?, description),
             base_price = COALESCE(?, base_price),
             unit_type = COALESCE(?, unit_type),
             is_active = COALESCE(?, is_active),
             updated_at = ?
           WHERE id = ?`
        )
        .run(
          service.name,
          service.category,
          service.description,
          service.basePrice,
          service.unitType,
          service.isActive !== undefined ? (service.isActive ? 1 : 0) : null,
          now,
          id
        );

      const s = this.db
        .prepare('SELECT * FROM services WHERE id = ?')
        .get(id) as any;

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        basePrice: s.base_price,
        unitType: s.unit_type,
        isActive: s.is_active === 1,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      };
    } catch (error) {
      logger.error('Error updating service:', error);
      throw new DatabaseError('Failed to update service');
    }
  }

  async deleteService(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM services WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting service:', error);
      throw new DatabaseError('Failed to delete service');
    }
  }

  // ===== User Operations =====
  async getAllUsers(): Promise<any[]> {
    try {
      const users = this.db
        .prepare('SELECT * FROM users ORDER BY name ASC')
        .all() as any[];

      return users.map((u) => {
        // Get roles for user
        const roleIds = this.db
          .prepare('SELECT role_id FROM user_roles WHERE user_id = ?')
          .all(u.id) as any[];
        
        const roles = [];
        for (const { role_id } of roleIds) {
          const role = this.db
            .prepare('SELECT * FROM roles WHERE id = ?')
            .get(role_id) as any;
          if (role) {
            roles.push({
              id: role.id,
              name: role.name,
              systemRole: role.system_role,
              permissions: JSON.parse(role.permissions || '{}'),
            });
          }
        }

        return {
          id: u.id,
          email: u.email,
          name: u.name,
          status: u.status,
          roleIds: roleIds.map((r: any) => r.role_id),
          roles,
          lastLoginAt: u.last_login_at,
          createdAt: u.created_at,
        };
      });
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw new DatabaseError('Failed to get users');
    }
  }

  async createUser(user: any): Promise<any> {
    const transaction = this.db.transaction(() => {
      const now = Date.now();
      const result = this.db
        .prepare(
          `INSERT INTO users (email, password_hash, name, status, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(user.email, user.passwordHash, user.name, user.status || 'active', now);

      const newUser = this.db
        .prepare('SELECT * FROM users WHERE rowid = ?')
        .get(result.lastInsertRowid) as any;

      // Assign roles if provided
      if (user.roleIds && user.roleIds.length > 0) {
        for (const roleId of user.roleIds) {
          this.db
            .prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
            .run(newUser.id, roleId);
        }
      }

      return {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        status: newUser.status,
        roleIds: user.roleIds || [],
        createdAt: newUser.created_at,
      };
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error creating user:', error);
      throw new DatabaseError('Failed to create user');
    }
  }

  async updateUser(id: string, user: any): Promise<any | null> {
    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (user.name !== undefined) {
        updates.push('name = ?');
        values.push(user.name);
      }
      if (user.email !== undefined) {
        updates.push('email = ?');
        values.push(user.email);
      }
      if (user.passwordHash !== undefined) {
        updates.push('password_hash = ?');
        values.push(user.passwordHash);
      }
      if (user.status !== undefined) {
        updates.push('status = ?');
        values.push(user.status);
      }

      if (updates.length > 0) {
        values.push(id);
        this.db
          .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
          .run(...values);
      }

      // Update roles if provided
      if (user.roleIds !== undefined) {
        this.db
          .prepare('DELETE FROM user_roles WHERE user_id = ?')
          .run(id);
        for (const roleId of user.roleIds) {
          this.db
            .prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
            .run(id, roleId);
        }
      }

      const updatedUser = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as any;

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        status: updatedUser.status,
        roleIds: user.roleIds || [],
        createdAt: updatedUser.created_at,
      };
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error updating user:', error);
      throw new DatabaseError('Failed to update user');
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM users WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw new DatabaseError('Failed to delete user');
    }
  }

  // ===== Role Operations =====
  async getAllRoles(): Promise<any[]> {
    try {
      const roles = this.db
        .prepare('SELECT * FROM roles ORDER BY name ASC')
        .all() as any[];

      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: JSON.parse(r.permissions || '{}'),
      }));
    } catch (error) {
      logger.error('Error getting all roles:', error);
      throw new DatabaseError('Failed to get roles');
    }
  }

  async getRoleById(id: string): Promise<any | null> {
    try {
      const r = this.db
        .prepare('SELECT * FROM roles WHERE id = ?')
        .get(id) as any;

      if (!r) {
        return null;
      }

      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: JSON.parse(r.permissions || '{}'),
      };
    } catch (error) {
      logger.error('Error getting role by ID:', error);
      throw new DatabaseError('Failed to get role');
    }
  }

  async createRole(role: any): Promise<any> {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO roles (name, system_role, permissions)
           VALUES (?, ?, ?)`
        )
        .run(role.name, role.systemRole, JSON.stringify(role.permissions));

      const r = this.db
        .prepare('SELECT * FROM roles WHERE rowid = ?')
        .get(result.lastInsertRowid) as any;

      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: JSON.parse(r.permissions || '{}'),
      };
    } catch (error) {
      logger.error('Error creating role:', error);
      throw new DatabaseError('Failed to create role');
    }
  }

  async updateRole(id: string, role: any): Promise<any | null> {
    try {
      const existing = this.db
        .prepare('SELECT * FROM roles WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      this.db
        .prepare(
          `UPDATE roles SET 
             name = COALESCE(?, name),
             system_role = COALESCE(?, system_role),
             permissions = COALESCE(?, permissions)
           WHERE id = ?`
        )
        .run(
          role.name,
          role.systemRole,
          role.permissions ? JSON.stringify(role.permissions) : null,
          id
        );

      const r = this.db
        .prepare('SELECT * FROM roles WHERE id = ?')
        .get(id) as any;

      return {
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
        permissions: JSON.parse(r.permissions || '{}'),
      };
    } catch (error) {
      logger.error('Error updating role:', error);
      throw new DatabaseError('Failed to update role');
    }
  }

  async deleteRole(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM roles WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting role:', error);
      throw new DatabaseError('Failed to delete role');
    }
  }

  // ===== Settings Operations =====
  async getSettings(): Promise<any | null> {
    try {
      const s = this.db
        .prepare('SELECT * FROM settings WHERE id = 1')
        .get() as any;

      if (!s) {
        return null;
      }

      return {
        taxRateDefault: s.tax_rate_default,
        storeName: s.store_name,
        storeEmail: s.store_email,
        storePhone: s.store_phone,
        timezone: s.timezone,
        logoUrl: s.logo_url,
        iconUrl: s.icon_url,
        brandColor: s.brand_color,
        config: s.config ? JSON.parse(s.config) : {},
      };
    } catch (error) {
      logger.error('Error getting settings:', error);
      throw new DatabaseError('Failed to get settings');
    }
  }

  async updateSettings(settings: any): Promise<any> {
    try {
      // Try to insert or update settings
      const existing = this.db
        .prepare('SELECT * FROM settings WHERE id = 1')
        .get();

      if (existing) {
        this.db
          .prepare(
            `UPDATE settings SET 
               tax_rate_default = COALESCE(?, tax_rate_default),
               store_name = COALESCE(?, store_name),
               store_email = COALESCE(?, store_email),
               store_phone = COALESCE(?, store_phone),
               timezone = COALESCE(?, timezone),
               logo_url = COALESCE(?, logo_url),
               icon_url = COALESCE(?, icon_url),
               brand_color = COALESCE(?, brand_color),
               config = COALESCE(?, config)
             WHERE id = 1`
          )
          .run(
            settings.taxRateDefault,
            settings.storeName,
            settings.storeEmail,
            settings.storePhone,
            settings.timezone,
            settings.logoUrl,
            settings.iconUrl,
            settings.brandColor,
            settings.config ? JSON.stringify(settings.config) : null
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO settings (id, tax_rate_default, store_name, store_email, store_phone, timezone, logo_url, icon_url, brand_color, config)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settings.taxRateDefault || 0,
            settings.storeName || 'My Store',
            settings.storeEmail,
            settings.storePhone,
            settings.timezone || 'UTC',
            settings.logoUrl,
            settings.iconUrl,
            settings.brandColor,
            settings.config ? JSON.stringify(settings.config) : null
          );
      }

      const s = this.db
        .prepare('SELECT * FROM settings WHERE id = 1')
        .get() as any;

      return {
        taxRateDefault: s.tax_rate_default,
        storeName: s.store_name,
        storeEmail: s.store_email,
        storePhone: s.store_phone,
        timezone: s.timezone,
        logoUrl: s.logo_url,
        iconUrl: s.icon_url,
        brandColor: s.brand_color,
        config: s.config ? JSON.parse(s.config) : {},
      };
    } catch (error) {
      logger.error('Error updating settings:', error);
      throw new DatabaseError('Failed to update settings');
    }
  }

  // ===== Audit Log Operations =====
  async createAuditLog(log: any): Promise<any> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          `INSERT INTO audit_logs (timestamp, user_id, action, entity, entity_id, before, after)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          now,
          log.userId,
          log.action,
          log.entity,
          log.entityId,
          log.before ? JSON.stringify(log.before) : null,
          log.after ? JSON.stringify(log.after) : null
        );

      const l = this.db
        .prepare('SELECT * FROM audit_logs WHERE rowid = ?')
        .get(result.lastInsertRowid) as any;

      return {
        id: l.id,
        timestamp: l.timestamp,
        userId: l.user_id,
        action: l.action,
        entity: l.entity,
        entityId: l.entity_id,
        before: l.before ? JSON.parse(l.before) : null,
        after: l.after ? JSON.parse(l.after) : null,
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

      if (options?.userId) {
        query += ' WHERE al.user_id = ?';
        params.push(options.userId);
      }

      query += ' ORDER BY al.timestamp DESC';

      if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options?.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }

      const logs = this.db.prepare(query).all(...params) as any[];

      return logs.map((l) => ({
        id: l.id,
        timestamp: l.timestamp,
        userId: l.user_id,
        userName: l.user_name,
        userEmail: l.user_email,
        action: l.action,
        entity: l.entity,
        entityId: l.entity_id,
        before: l.before ? JSON.parse(l.before) : null,
        after: l.after ? JSON.parse(l.after) : null,
      }));
    } catch (error) {
      logger.error('Error getting audit logs:', error);
      throw new DatabaseError('Failed to get audit logs');
    }
  }

  // ===== Quote Operations =====
  async getAllQuotes(): Promise<any[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           ORDER BY q.created_at DESC`
        )
        .all() as any[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as any[];

        return {
          id: q.id,
          customerId: q.customer_id,
          customerName: q.customer_name,
          customerEmail: q.customer_email,
          status: q.status,
          subtotal: q.subtotal,
          taxTotal: q.tax_total,
          total: q.total,
          notes: q.notes,
          createdAt: q.created_at,
          expiresAt: q.expires_at,
          items: items.map((i) => ({
            id: i.id,
            quoteId: i.quote_id,
            serviceId: i.service_id,
            serviceName: i.service_name,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            lineTotal: i.line_total,
          })),
        };
      });
    } catch (error) {
      logger.error('Error getting all quotes:', error);
      throw new DatabaseError('Failed to get quotes');
    }
  }

  async getQuoteById(id: string): Promise<any | null> {
    try {
      const q = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           WHERE q.id = ?`
        )
        .get(id) as any;

      if (!q) {
        return null;
      }

      const items = this.db
        .prepare(
          `SELECT qi.*, s.name as service_name
           FROM quote_items qi
           LEFT JOIN services s ON qi.service_id = s.id
           WHERE qi.quote_id = ?`
        )
        .all(id) as any[];

      return {
        id: q.id,
        customerId: q.customer_id,
        customerName: q.customer_name,
        customerEmail: q.customer_email,
        status: q.status,
        subtotal: q.subtotal,
        taxTotal: q.tax_total,
        total: q.total,
        notes: q.notes,
        createdAt: q.created_at,
        expiresAt: q.expires_at,
        items: items.map((i) => ({
          id: i.id,
          quoteId: i.quote_id,
          serviceId: i.service_id,
          serviceName: i.service_name,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          lineTotal: i.line_total,
        })),
      };
    } catch (error) {
      logger.error('Error getting quote by ID:', error);
      throw new DatabaseError('Failed to get quote');
    }
  }

  async getQuotesByCustomer(customerId: string): Promise<any[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           WHERE q.customer_id = ?
           ORDER BY q.created_at DESC`
        )
        .all(customerId) as any[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as any[];

        return {
          id: q.id,
          customerId: q.customer_id,
          customerName: q.customer_name,
          customerEmail: q.customer_email,
          status: q.status,
          subtotal: q.subtotal,
          taxTotal: q.tax_total,
          total: q.total,
          notes: q.notes,
          createdAt: q.created_at,
          expiresAt: q.expires_at,
          items: items.map((i) => ({
            id: i.id,
            quoteId: i.quote_id,
            serviceId: i.service_id,
            serviceName: i.service_name,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            lineTotal: i.line_total,
          })),
        };
      });
    } catch (error) {
      logger.error('Error getting quotes by customer:', error);
      throw new DatabaseError('Failed to get quotes');
    }
  }

  async createQuote(quote: any): Promise<any> {
    const transaction = this.db.transaction(() => {
      const now = Date.now();
      const quoteResult = this.db
        .prepare(
          `INSERT INTO quotes (customer_id, status, subtotal, tax_total, total, notes, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          quote.customerId,
          quote.status || 'draft',
          quote.subtotal,
          quote.taxTotal || 0,
          quote.total,
          quote.notes,
          now,
          quote.expiresAt
        );

      const newQuote = this.db
        .prepare('SELECT * FROM quotes WHERE rowid = ?')
        .get(quoteResult.lastInsertRowid) as any;

      const items = [];
      if (quote.items && quote.items.length > 0) {
        for (const item of quote.items) {
          const itemResult = this.db
            .prepare(
              `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price, line_total)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              newQuote.id,
              item.serviceId,
              item.description,
              item.quantity,
              item.unitPrice,
              item.lineTotal
            );

          const newItem = this.db
            .prepare('SELECT * FROM quote_items WHERE rowid = ?')
            .get(itemResult.lastInsertRowid) as any;

          items.push({
            id: newItem.id,
            quoteId: newQuote.id,
            serviceId: newItem.service_id,
            description: newItem.description,
            quantity: newItem.quantity,
            unitPrice: newItem.unit_price,
            lineTotal: newItem.line_total,
          });
        }
      }

      return {
        id: newQuote.id,
        customerId: newQuote.customer_id,
        status: newQuote.status,
        subtotal: newQuote.subtotal,
        taxTotal: newQuote.tax_total,
        total: newQuote.total,
        notes: newQuote.notes,
        createdAt: newQuote.created_at,
        expiresAt: newQuote.expires_at,
        items,
      };
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error creating quote:', error);
      throw new DatabaseError('Failed to create quote');
    }
  }

  async updateQuote(id: string, quote: any): Promise<any | null> {
    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM quotes WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      this.db
        .prepare(
          `UPDATE quotes SET
             customer_id = COALESCE(?, customer_id),
             status = COALESCE(?, status),
             subtotal = COALESCE(?, subtotal),
             tax_total = COALESCE(?, tax_total),
             total = COALESCE(?, total),
             notes = COALESCE(?, notes),
             expires_at = COALESCE(?, expires_at)
           WHERE id = ?`
        )
        .run(
          quote.customerId,
          quote.status,
          quote.subtotal,
          quote.taxTotal,
          quote.total,
          quote.notes,
          quote.expiresAt,
          id
        );

      if (quote.items) {
        this.db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(id);
        for (const item of quote.items) {
          this.db
            .prepare(
              `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price, line_total)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(id, item.serviceId, item.description, item.quantity, item.unitPrice, item.lineTotal);
        }
      }

      return this.getQuoteById(id);
    });

    try {
      return transaction();
    } catch (error) {
      logger.error('Error updating quote:', error);
      throw new DatabaseError('Failed to update quote');
    }
  }

  async updateQuoteStatus(id: string, status: string): Promise<any | null> {
    try {
      const result = this.db
        .prepare('UPDATE quotes SET status = ? WHERE id = ?')
        .run(status, id);

      if (result.changes === 0) {
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
      const result = this.db
        .prepare('DELETE FROM quotes WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting quote:', error);
      throw new DatabaseError('Failed to delete quote');
    }
  }

  // ===== Order Operations Extended =====
  async getOrdersByCustomerEmail(email: string): Promise<any[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC')
        .all(email) as any[];

      return orders.map((order) => {
        const items = this.db
          .prepare('SELECT * FROM order_items WHERE order_id = ?')
          .all(order.id) as any[];

        return {
          id: order.id,
          createdAt: order.created_at,
          subtotal: order.subtotal,
          discountTotal: order.discount_total,
          taxTotal: order.tax_total,
          total: order.total,
          paymentMethod: order.payment_method,
          customerEmail: order.customer_email,
          customerPhone: order.customer_phone,
          items: items.map((item) => ({
            id: item.id,
            orderId: item.order_id,
            productId: item.product_id,
            variantId: item.variant_id,
            nameSnapshot: item.name_snapshot,
            size: item.size,
            color: item.color,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            lineDiscount: item.line_discount,
            lineTotal: item.line_total,
            notes: item.notes,
          })),
        };
      });
    } catch (error) {
      logger.error('Error getting orders by customer email:', error);
      throw new DatabaseError('Failed to get orders');
    }
  }
}
