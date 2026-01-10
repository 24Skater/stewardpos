import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  async getUserByEmail(email: string): Promise<Record<string, unknown> | null> {
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
  async getAllProducts(): Promise<unknown[]> {
    try {
      const products = this.db
        .prepare('SELECT * FROM products ORDER BY name ASC')
        .all() as unknown[];

      // Get variants for each product
      const productsWithVariants = products.map((product) => {
        const variants = this.db
          .prepare('SELECT * FROM product_variants WHERE product_id = ?')
          .all(product.id) as unknown[];

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
        .all(id) as unknown[];

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

  async createProduct(product: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateProduct(id: string, product: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  async createOrder(order: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async getAllOrders(): Promise<unknown[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders ORDER BY created_at DESC')
        .all() as unknown[];

      // Get all order items
      const itemsMap = new Map<string, unknown[]>();
      const orderIds = orders.map(o => o.id);
      
      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        const items = this.db
          .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`)
          .all(...orderIds) as unknown[];
        
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
        .all(id) as unknown[];

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
  async getAllCustomers(): Promise<unknown[]> {
    try {
      const customers = this.db
        .prepare('SELECT * FROM customers ORDER BY name ASC')
        .all() as unknown[];

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

  async createCustomer(customer: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateCustomer(id: string, customer: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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

  async archiveCustomer(id: string, archivedBy: string, reason?: string): Promise<boolean> {
    const transaction = this.db.transaction(() => {
      // Get customer data
      const customer = this.db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(id) as any;

      if (!customer) {
        return false;
      }

      // Insert into archived_customers
      this.db.prepare(
        `INSERT INTO archived_customers 
         (id, name, email, phone, organization, address, city, state, zip, country, notes, 
          created_at, updated_at, archived_by, archive_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        customer.id, customer.name, customer.email, customer.phone, customer.org,
        customer.address, customer.city, customer.state, customer.zip, customer.country,
        customer.notes, customer.created_at, customer.updated_at, archivedBy, reason || null
      );

      // Archive associated quotes
      const quotes = this.db
        .prepare('SELECT * FROM quotes WHERE customer_id = ?')
        .all(id) as unknown[];

      for (const quote of quotes) {
        this.db.prepare(
          `INSERT INTO archived_quotes 
           (id, customer_id, quote_number, status, items, subtotal, tax, total, notes, 
            valid_until, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          quote.id, quote.customer_id, quote.quote_number, quote.status, quote.items,
          quote.subtotal, quote.tax, quote.total, quote.notes, quote.valid_until,
          quote.created_at, quote.updated_at, quote.created_by
        );
      }

      // Archive associated orders
      const orders = this.db
        .prepare('SELECT * FROM orders WHERE customer_id = ?')
        .all(id) as unknown[];

      for (const order of orders) {
        this.db.prepare(
          `INSERT INTO archived_orders 
           (id, customer_id, order_number, status, items, subtotal, tax, discount, total, 
            payment_method, notes, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          order.id, order.customer_id, order.order_number, order.status, order.items,
          order.subtotal, order.tax, order.discount, order.total, order.payment_method,
          order.notes, order.created_at, order.updated_at, order.created_by
        );
      }

      // Delete from original tables
      this.db.prepare('DELETE FROM quotes WHERE customer_id = ?').run(id);
      this.db.prepare('DELETE FROM orders WHERE customer_id = ?').run(id);
      this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);

      return true;
    });

    try {
      const result = transaction();
      if (result) {
        logger.info(`Customer ${id} archived successfully`);
      }
      return result;
    } catch (error) {
      logger.error('Error archiving customer:', error);
      throw new DatabaseError('Failed to archive customer');
    }
  }

  async permanentDeleteCustomer(id: string): Promise<boolean> {
    const transaction = this.db.transaction(() => {
      // Check if customer exists and get their email (needed for orders lookup)
      const customer = this.db
        .prepare('SELECT id, email FROM customers WHERE id = ?')
        .get(id) as { id: string; email: string | null } | undefined;

      if (!customer) {
        return false;
      }

      const customerEmail = customer.email;

      // Get all return IDs for this customer (returns has customer_id)
      const returnIds = this.db.prepare('SELECT id FROM returns WHERE customer_id = ?').all(id) as { id: string }[];
      
      // Get all order IDs for this customer (orders uses customer_email, not customer_id)
      const orderIds = customerEmail
        ? this.db.prepare('SELECT id FROM orders WHERE customer_email = ?').all(customerEmail) as { id: string }[]
        : [];

      // Delete all related records first (order matters due to foreign keys)
      // 1. Delete refund_transactions and receipt_emails by return_id or order_id
      for (const ret of returnIds) {
        this.db.prepare('DELETE FROM refund_transactions WHERE return_id = ?').run(ret.id);
        this.db.prepare('DELETE FROM receipt_emails WHERE return_id = ?').run(ret.id);
      }
      for (const ord of orderIds) {
        this.db.prepare('DELETE FROM refund_transactions WHERE order_id = ?').run(ord.id);
        this.db.prepare('DELETE FROM receipt_emails WHERE order_id = ?').run(ord.id);
        // Delete discount_usage and loyalty_transactions for these orders
        this.db.prepare('DELETE FROM discount_usage WHERE order_id = ?').run(ord.id);
        this.db.prepare('DELETE FROM loyalty_transactions WHERE order_id = ?').run(ord.id);
        // Delete store credits that were used on these orders
        this.db.prepare('DELETE FROM store_credits WHERE used_order_id = ?').run(ord.id);
      }
      
      // 2. Delete store_credits (has customer_id directly and return_id)
      this.db.prepare('DELETE FROM store_credits WHERE customer_id = ?').run(id);
      for (const ret of returnIds) {
        this.db.prepare('DELETE FROM store_credits WHERE return_id = ?').run(ret.id);
      }
      
      // 3. Delete returns (return_items cascade automatically)
      this.db.prepare('DELETE FROM returns WHERE customer_id = ?').run(id);
      
      // 4. Delete quotes (has customer_id)
      this.db.prepare('DELETE FROM quotes WHERE customer_id = ?').run(id);
      
      // 5. Delete orders (uses customer_email) - order_items cascade automatically
      if (customerEmail) {
        this.db.prepare('DELETE FROM orders WHERE customer_email = ?').run(customerEmail);
      }
      
      // 6. Finally delete the customer
      this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);

      return true;
    });

    try {
      const result = transaction();
      if (result) {
        logger.info(`Customer ${id} permanently deleted`);
      }
      return result;
    } catch (error) {
      logger.error('Error permanently deleting customer:', error);
      throw new DatabaseError('Failed to permanently delete customer');
    }
  }

  close(): void {
    this.db.close();
    logger.info('SQLite connection closed');
  }

  // ===== Service Operations =====
  async getAllServices(): Promise<unknown[]> {
    try {
      const services = this.db
        .prepare('SELECT * FROM services ORDER BY name ASC')
        .all() as unknown[];

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

  async createService(service: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateService(id: string, service: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
  async getAllUsers(): Promise<unknown[]> {
    try {
      const users = this.db
        .prepare('SELECT * FROM users ORDER BY name ASC')
        .all() as unknown[];

      return users.map((u) => {
        // Get roles for user
        const roleIds = this.db
          .prepare('SELECT role_id FROM user_roles WHERE user_id = ?')
          .all(u.id) as unknown[];
        
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
          roleIds: roleIds.map((r: Record<string, unknown>) => r.role_id as string),
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

  async createUser(user: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateUser(id: string, user: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      const updates: string[] = [];
      const values: unknown[] = [];

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
  async getAllRoles(): Promise<unknown[]> {
    try {
      const roles = this.db
        .prepare('SELECT * FROM roles ORDER BY name ASC')
        .all() as unknown[];

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

  async createRole(role: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateRole(id: string, role: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
        // Receipt branding
        storeAddress: s.store_address,
        storeCity: s.store_city,
        storeState: s.store_state,
        storeZip: s.store_zip,
        storeNumber: s.store_number,
        receiptLogoUrl: s.receipt_logo_url,
        receiptHeaderText: s.receipt_header_text,
        receiptFooterText: s.receipt_footer_text,
        receiptShowLogo: s.receipt_show_logo !== 0,
        receiptShowBarcode: s.receipt_show_barcode !== 0,
      };
    } catch (error) {
      logger.error('Error getting settings:', error);
      throw new DatabaseError('Failed to get settings');
    }
  }

  async updateSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
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
               config = COALESCE(?, config),
               store_address = COALESCE(?, store_address),
               store_city = COALESCE(?, store_city),
               store_state = COALESCE(?, store_state),
               store_zip = COALESCE(?, store_zip),
               store_number = COALESCE(?, store_number),
               receipt_logo_url = COALESCE(?, receipt_logo_url),
               receipt_header_text = COALESCE(?, receipt_header_text),
               receipt_footer_text = COALESCE(?, receipt_footer_text),
               receipt_show_logo = COALESCE(?, receipt_show_logo),
               receipt_show_barcode = COALESCE(?, receipt_show_barcode)
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
            settings.config ? JSON.stringify(settings.config) : null,
            settings.storeAddress,
            settings.storeCity,
            settings.storeState,
            settings.storeZip,
            settings.storeNumber,
            settings.receiptLogoUrl,
            settings.receiptHeaderText,
            settings.receiptFooterText,
            settings.receiptShowLogo !== undefined ? (settings.receiptShowLogo ? 1 : 0) : null,
            settings.receiptShowBarcode !== undefined ? (settings.receiptShowBarcode ? 1 : 0) : null
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO settings (
              id, tax_rate_default, store_name, store_email, store_phone, timezone, 
              logo_url, icon_url, brand_color, config,
              store_address, store_city, store_state, store_zip, store_number,
              receipt_logo_url, receipt_header_text, receipt_footer_text, receipt_show_logo, receipt_show_barcode
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settings.taxRateDefault || 0,
            settings.storeName || 'StewardPOS',
            settings.storeEmail,
            settings.storePhone,
            settings.timezone || 'UTC',
            settings.logoUrl,
            settings.iconUrl,
            settings.brandColor,
            settings.config ? JSON.stringify(settings.config) : null,
            settings.storeAddress,
            settings.storeCity,
            settings.storeState,
            settings.storeZip,
            settings.storeNumber,
            settings.receiptLogoUrl,
            settings.receiptHeaderText,
            settings.receiptFooterText,
            settings.receiptShowLogo !== false ? 1 : 0,
            settings.receiptShowBarcode !== false ? 1 : 0
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
        storeAddress: s.store_address,
        storeCity: s.store_city,
        storeState: s.store_state,
        storeZip: s.store_zip,
        storeNumber: s.store_number,
        receiptLogoUrl: s.receipt_logo_url,
        receiptHeaderText: s.receipt_header_text,
        receiptFooterText: s.receipt_footer_text,
        receiptShowLogo: s.receipt_show_logo !== 0,
        receiptShowBarcode: s.receipt_show_barcode !== 0,
      };
    } catch (error) {
      logger.error('Error updating settings:', error);
      throw new DatabaseError('Failed to update settings');
    }
  }

  // ===== Audit Log Operations =====
  async createAuditLog(log: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async getAuditLogs(options?: { limit?: number; offset?: number; userId?: string }): Promise<unknown[]> {
    try {
      let query = `
        SELECT al.*, u.name as user_name, u.email as user_email
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
      `;
      const params: unknown[] = [];

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

      const logs = this.db.prepare(query).all(...params) as unknown[];

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
  async getAllQuotes(): Promise<unknown[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           ORDER BY q.created_at DESC`
        )
        .all() as unknown[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as unknown[];

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
        .all(id) as unknown[];

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

  async getQuotesByCustomer(customerId: string): Promise<unknown[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           WHERE q.customer_id = ?
           ORDER BY q.created_at DESC`
        )
        .all(customerId) as unknown[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as unknown[];

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

  async createQuote(quote: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateQuote(id: string, quote: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
  async getOrdersByCustomerEmail(email: string): Promise<unknown[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC')
        .all(email) as unknown[];

      return orders.map((order) => {
        const items = this.db
          .prepare('SELECT * FROM order_items WHERE order_id = ?')
          .all(order.id) as unknown[];

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

  // ===== API Key Operations =====
  async getAllApiKeys(): Promise<unknown[]> {
    try {
      const keys = this.db
        .prepare(
          `SELECT ak.*, u.name as created_by_name, u.email as created_by_email
           FROM api_keys ak
           LEFT JOIN users u ON ak.created_by = u.id
           ORDER BY ak.created_at DESC`
        )
        .all() as unknown[];

      return keys.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: JSON.parse(k.scopes || '["read"]'),
        rateLimit: k.rate_limit,
        isActive: !!k.is_active,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        createdBy: k.created_by,
        createdByName: k.created_by_name,
        createdByEmail: k.created_by_email,
        createdAt: k.created_at,
        updatedAt: k.updated_at,
      }));
    } catch (error) {
      logger.error('Error getting all API keys:', error);
      throw new DatabaseError('Failed to get API keys');
    }
  }

  async getApiKeyById(id: string): Promise<any | null> {
    try {
      const k = this.db
        .prepare(
          `SELECT ak.*, u.name as created_by_name, u.email as created_by_email
           FROM api_keys ak
           LEFT JOIN users u ON ak.created_by = u.id
           WHERE ak.id = ?`
        )
        .get(id) as any;

      if (!k) {
        return null;
      }

      return {
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: JSON.parse(k.scopes || '["read"]'),
        rateLimit: k.rate_limit,
        isActive: !!k.is_active,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        createdBy: k.created_by,
        createdByName: k.created_by_name,
        createdByEmail: k.created_by_email,
        createdAt: k.created_at,
        updatedAt: k.updated_at,
      };
    } catch (error) {
      logger.error('Error getting API key by ID:', error);
      throw new DatabaseError('Failed to get API key');
    }
  }

  async getApiKeyByPrefix(prefix: string): Promise<any | null> {
    try {
      const k = this.db
        .prepare(`SELECT * FROM api_keys WHERE key_prefix = ? AND is_active = 1`)
        .get(prefix) as any;

      if (!k) {
        return null;
      }

      return {
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        keyHash: k.key_hash,
        scopes: JSON.parse(k.scopes || '["read"]'),
        rateLimit: k.rate_limit,
        isActive: !!k.is_active,
        expiresAt: k.expires_at,
      };
    } catch (error) {
      logger.error('Error getting API key by prefix:', error);
      throw new DatabaseError('Failed to get API key');
    }
  }

  async createApiKey(apiKey: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const now = Date.now();
      const id = crypto.randomUUID();

      this.db
        .prepare(
          `INSERT INTO api_keys (id, name, description, key_prefix, key_hash, scopes, rate_limit, expires_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          apiKey.name,
          apiKey.description,
          apiKey.keyPrefix,
          apiKey.keyHash,
          JSON.stringify(apiKey.scopes || ['read']),
          apiKey.rateLimit || 1000,
          apiKey.expiresAt,
          apiKey.createdBy,
          now,
          now
        );

      return {
        id,
        name: apiKey.name,
        description: apiKey.description,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes || ['read'],
        rateLimit: apiKey.rateLimit || 1000,
        isActive: true,
        expiresAt: apiKey.expiresAt,
        createdBy: apiKey.createdBy,
        createdAt: now,
      };
    } catch (error) {
      logger.error('Error creating API key:', error);
      throw new DatabaseError('Failed to create API key');
    }
  }

  async updateApiKey(id: string, apiKey: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const existing = this.db
        .prepare('SELECT * FROM api_keys WHERE id = ?')
        .get(id) as any;

      if (!existing) {
        return null;
      }

      this.db
        .prepare(
          `UPDATE api_keys SET
             name = COALESCE(?, name),
             description = COALESCE(?, description),
             scopes = COALESCE(?, scopes),
             rate_limit = COALESCE(?, rate_limit),
             is_active = COALESCE(?, is_active),
             expires_at = COALESCE(?, expires_at),
             updated_at = ?
           WHERE id = ?`
        )
        .run(
          apiKey.name,
          apiKey.description,
          apiKey.scopes ? JSON.stringify(apiKey.scopes) : null,
          apiKey.rateLimit,
          apiKey.isActive !== undefined ? (apiKey.isActive ? 1 : 0) : null,
          apiKey.expiresAt,
          Date.now(),
          id
        );

      return this.getApiKeyById(id);
    } catch (error) {
      logger.error('Error updating API key:', error);
      throw new DatabaseError('Failed to update API key');
    }
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    try {
      this.db
        .prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
        .run(Date.now(), id);
    } catch (error) {
      logger.error('Error updating API key last used:', error);
    }
  }

  async deleteApiKey(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare('DELETE FROM api_keys WHERE id = ?')
        .run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting API key:', error);
      throw new DatabaseError('Failed to delete API key');
    }
  }

  // ===== Returns & Refunds Operations =====

  async getAllReturns(filters?: { status?: string; startDate?: number; endDate?: number; customerId?: string }): Promise<unknown[]> {
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
      const params: unknown[] = [];

      if (filters?.status) {
        query += ' AND r.status = ?';
        params.push(filters.status);
      }
      if (filters?.startDate) {
        query += ' AND r.created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        query += ' AND r.created_at <= ?';
        params.push(filters.endDate);
      }
      if (filters?.customerId) {
        query += ' AND r.customer_id = ?';
        params.push(filters.customerId);
      }

      query += ' ORDER BY r.created_at DESC';

      const returns = this.db.prepare(query).all(...params) as unknown[];

      return returns.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting all returns:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async getReturnById(id: string): Promise<any | null> {
    try {
      const row = this.db.prepare(
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
         WHERE r.id = ?`
      ).get(id) as any;

      if (!row) {
        return null;
      }

      // Get return items
      const items = this.db.prepare(
        'SELECT * FROM return_items WHERE return_id = ?'
      ).all(id) as unknown[];

      const returnData = this.mapReturnRow(row);
      returnData.items = items.map(item => ({
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
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        condition: item.condition,
        restocked: Boolean(item.restocked),
        restockedAt: item.restocked_at,
        notes: item.notes,
      }));

      return returnData;
    } catch (error) {
      logger.error('Error getting return by ID:', error);
      throw new DatabaseError('Failed to get return');
    }
  }

  async getReturnsByOrder(orderId: string): Promise<unknown[]> {
    try {
      const returns = this.db.prepare(
        `SELECT r.*, u.name as created_by_name
         FROM returns r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.original_order_id = ?
         ORDER BY r.created_at DESC`
      ).all(orderId) as any[];

      const result = returns.map(r => this.mapReturnRow(r));

      // Get items for each return
      for (const ret of result) {
        const items = this.db.prepare(
          'SELECT * FROM return_items WHERE return_id = ?'
        ).all(ret.id) as unknown[];
        ret.items = items.map(item => ({
          id: item.id,
          productId: item.product_id,
          nameSnapshot: item.name_snapshot,
          returnQuantity: item.return_quantity,
          lineTotal: item.line_total,
        }));
      }

      return result;
    } catch (error) {
      logger.error('Error getting returns by order:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async getReturnsByCustomer(customerId: string): Promise<any[]> {
    try {
      const returns = this.db.prepare(
        `SELECT r.*, o.total as original_order_total
         FROM returns r
         LEFT JOIN orders o ON r.original_order_id = o.id
         WHERE r.customer_id = ?
         ORDER BY r.created_at DESC`
      ).all(customerId) as any[];

      return returns.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting returns by customer:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async createReturn(returnData: any): Promise<any> {
    try {
      const returnId = crypto.randomUUID();

      // Insert return
      this.db.prepare(
        `INSERT INTO returns (
          id, original_order_id, return_number, return_type, status,
          customer_email, customer_phone, customer_id,
          subtotal, tax_total, total,
          refund_method, refund_status,
          reason_code, reason_details, internal_notes,
          restock_items, restocking_fee, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        returnId,
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
        returnData.restockItems !== false ? 1 : 0,
        returnData.restockingFee || 0,
        returnData.createdBy,
        Date.now(),
        Date.now()
      );

      // Insert return items
      const insertItem = this.db.prepare(
        `INSERT INTO return_items (
          id, return_id, original_order_item_id, product_id, variant_id,
          name_snapshot, size, color,
          original_quantity, return_quantity,
          unit_price, line_total, condition, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of returnData.items || []) {
        insertItem.run(
          crypto.randomUUID(),
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
          item.notes
        );
      }

      return this.getReturnById(returnId);
    } catch (error) {
      logger.error('Error creating return:', error);
      throw new DatabaseError('Failed to create return');
    }
  }

  async updateReturnStatus(id: string, data: { status: string; internalNotes?: string; approvedBy?: string }): Promise<any | null> {
    try {
      this.db.prepare(
        `UPDATE returns SET
          status = ?,
          internal_notes = COALESCE(?, internal_notes),
          approved_by = COALESCE(?, approved_by),
          updated_at = ?
        WHERE id = ?`
      ).run(data.status, data.internalNotes, data.approvedBy, Date.now(), id);

      return this.getReturnById(id);
    } catch (error) {
      logger.error('Error updating return status:', error);
      throw new DatabaseError('Failed to update return status');
    }
  }

  async updateReturnRefundStatus(id: string, data: any): Promise<any | null> {
    try {
      this.db.prepare(
        `UPDATE returns SET
          refund_status = COALESCE(?, refund_status),
          refund_method = COALESCE(?, refund_method),
          refund_processed_at = COALESCE(?, refund_processed_at),
          store_credit_code = COALESCE(?, store_credit_code),
          store_credit_amount = COALESCE(?, store_credit_amount),
          updated_at = ?
        WHERE id = ?`
      ).run(
        data.refundStatus,
        data.refundMethod,
        data.refundProcessedAt,
        data.storeCreditCode,
        data.storeCreditAmount,
        Date.now(),
        id
      );

      return this.getReturnById(id);
    } catch (error) {
      logger.error('Error updating return refund status:', error);
      throw new DatabaseError('Failed to update return refund status');
    }
  }

  async getReturnStats(filters?: { startDate?: number; endDate?: number }): Promise<any> {
    try {
      let query = `
        SELECT
          COUNT(*) as total_returns,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_returns,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_returns,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_returns,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) as total_refunded,
          COALESCE(SUM(CASE WHEN refund_method = 'store_credit' THEN store_credit_amount ELSE 0 END), 0) as total_store_credits,
          COUNT(DISTINCT customer_id) as unique_customers
        FROM returns
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (filters?.startDate) {
        query += ' AND created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        query += ' AND created_at <= ?';
        params.push(filters.endDate);
      }

      const stats = this.db.prepare(query).get(...params) as any;

      return {
        totalReturns: stats.total_returns || 0,
        completedReturns: stats.completed_returns || 0,
        pendingReturns: stats.pending_returns || 0,
        rejectedReturns: stats.rejected_returns || 0,
        totalRefunded: stats.total_refunded || 0,
        totalStoreCredits: stats.total_store_credits || 0,
        uniqueCustomers: stats.unique_customers || 0,
      };
    } catch (error) {
      logger.error('Error getting return stats:', error);
      throw new DatabaseError('Failed to get return stats');
    }
  }

  async createRefundTransaction(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO refund_transactions (
          id, return_id, order_id, transaction_type, amount, currency,
          payment_method, processor_transaction_id, status, processed_by, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        data.returnId,
        data.orderId,
        data.transactionType,
        data.amount,
        data.currency || 'USD',
        data.paymentMethod,
        data.processorTransactionId,
        data.status || 'completed',
        data.processedBy,
        Date.now(),
        Date.now()
      );

      return this.db.prepare('SELECT * FROM refund_transactions WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Error creating refund transaction:', error);
      throw new DatabaseError('Failed to create refund transaction');
    }
  }

  async createStoreCredit(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO store_credits (
          id, customer_id, customer_email, return_id, code,
          original_amount, remaining_amount, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        data.customerId,
        data.customerEmail,
        data.returnId,
        data.code,
        data.originalAmount,
        data.remainingAmount,
        data.status || 'active',
        data.expiresAt,
        Date.now()
      );

      return this.db.prepare('SELECT * FROM store_credits WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Error creating store credit:', error);
      throw new DatabaseError('Failed to create store credit');
    }
  }

  async restockReturnItems(returnId: string, itemIds?: string[]): Promise<any[]> {
    try {
      // Get items to restock
      let query = 'SELECT * FROM return_items WHERE return_id = ? AND restocked = 0';
      const params: any[] = [returnId];

      const items = this.db.prepare(query).all(...params) as any[];
      const restockedItems: any[] = [];

      for (const item of items) {
        if (itemIds && itemIds.length > 0 && !itemIds.includes(item.id)) {
          continue;
        }

        // Update stock in product_variants
        if (item.variant_id) {
          this.db.prepare(
            'UPDATE product_variants SET stock = stock + ? WHERE id = ?'
          ).run(item.return_quantity, item.variant_id);
        }

        // Mark item as restocked
        this.db.prepare(
          'UPDATE return_items SET restocked = 1, restocked_at = ? WHERE id = ?'
        ).run(Date.now(), item.id);

        restockedItems.push({
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          nameSnapshot: item.name_snapshot,
          quantity: item.return_quantity,
        });
      }

      return restockedItems;
    } catch (error) {
      logger.error('Error restocking return items:', error);
      throw new DatabaseError('Failed to restock items');
    }
  }

  // Receipt email logging
  async logReceiptEmail(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO receipt_emails (
          id, order_id, return_id, recipient_email, subject, receipt_type, status, sent_by, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        data.orderId,
        data.returnId,
        data.recipientEmail,
        data.subject,
        data.receiptType,
        data.status || 'sent',
        data.sentBy,
        Date.now()
      );

      return this.db.prepare('SELECT * FROM receipt_emails WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Error logging receipt email:', error);
      throw new DatabaseError('Failed to log receipt email');
    }
  }

  async getReceiptEmailHistory(orderId: string): Promise<any[]> {
    try {
      const rows = this.db.prepare(
        `SELECT re.*, u.name as sent_by_name
         FROM receipt_emails re
         LEFT JOIN users u ON re.sent_by = u.id
         WHERE re.order_id = ?
         ORDER BY re.sent_at DESC`
      ).all(orderId) as any[];

      return rows.map(r => ({
        id: r.id,
        orderId: r.order_id,
        recipientEmail: r.recipient_email,
        subject: r.subject,
        receiptType: r.receipt_type,
        status: r.status,
        sentBy: r.sent_by,
        sentByName: r.sent_by_name,
        sentAt: r.sent_at,
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
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (filters.query) {
        query += ' AND (o.id LIKE ? OR o.customer_email LIKE ?)';
        params.push(`%${filters.query}%`, `%${filters.query}%`);
      }
      if (filters.startDate) {
        query += ' AND o.created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ' AND o.created_at <= ?';
        params.push(filters.endDate);
      }
      if (filters.customerEmail) {
        query += ' AND o.customer_email = ?';
        params.push(filters.customerEmail);
      }
      if (filters.minAmount !== undefined) {
        query += ' AND o.total >= ?';
        params.push(filters.minAmount);
      }
      if (filters.maxAmount !== undefined) {
        query += ' AND o.total <= ?';
        params.push(filters.maxAmount);
      }
      if (filters.paymentMethod) {
        query += ' AND o.payment_method = ?';
        params.push(filters.paymentMethod);
      }

      query += ' ORDER BY o.created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }

      const orders = this.db.prepare(query).all(...params) as any[];

      return orders.map(order => ({
        id: order.id,
        createdAt: order.created_at,
        subtotal: order.subtotal,
        discountTotal: order.discount_total,
        taxTotal: order.tax_total,
        total: order.total,
        paymentMethod: order.payment_method,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        itemCount: order.item_count,
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
      subtotal: row.subtotal,
      taxTotal: row.tax_total,
      total: row.total,
      refundMethod: row.refund_method,
      refundStatus: row.refund_status,
      refundProcessedAt: row.refund_processed_at,
      refundReference: row.refund_reference,
      storeCreditAmount: row.store_credit_amount || 0,
      storeCreditCode: row.store_credit_code,
      reasonCode: row.reason_code,
      reasonDetails: row.reason_details,
      internalNotes: row.internal_notes,
      restockItems: Boolean(row.restock_items),
      restockingFee: row.restocking_fee || 0,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by_name,
      originalOrderTotal: row.original_order_total,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===== Discount Types Operations =====
  
  async getAllDiscountTypes(): Promise<any[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM discount_types ORDER BY display_order, name').all() as any[];
      return rows.map(r => this.mapDiscountTypeRow(r));
    } catch (error) {
      logger.error('Error getting discount types:', error);
      throw new DatabaseError('Failed to get discount types');
    }
  }

  async getDiscountTypesForPOS(): Promise<any[]> {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM discount_types WHERE is_active = 1 AND show_in_pos = 1 ORDER BY display_order, name'
      ).all() as any[];
      return rows.map(r => this.mapDiscountTypeRow(r));
    } catch (error) {
      logger.error('Error getting POS discount types:', error);
      throw new DatabaseError('Failed to get discount types');
    }
  }

  async getDiscountTypeById(id: string): Promise<any | null> {
    try {
      const row = this.db.prepare('SELECT * FROM discount_types WHERE id = ?').get(id) as any;
      return row ? this.mapDiscountTypeRow(row) : null;
    } catch (error) {
      logger.error('Error getting discount type:', error);
      throw new DatabaseError('Failed to get discount type');
    }
  }

  async createDiscountType(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO discount_types (
          id, name, description, code, discount_type, discount_value,
          min_purchase, max_discount, applies_to, applicable_ids,
          requires_approval, approval_threshold, requires_employee_id,
          display_order, color, icon, show_in_pos, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, data.name, data.description, data.code, data.discountType, data.discountValue,
        data.minPurchase || 0, data.maxDiscount, data.appliesTo || 'all', 
        JSON.stringify(data.applicableIds || []),
        data.requiresApproval ? 1 : 0, data.approvalThreshold, data.requiresEmployeeId ? 1 : 0,
        data.displayOrder || 0, data.color || 'gray', data.icon, 
        data.showInPos !== false ? 1 : 0, data.isActive !== false ? 1 : 0,
        Date.now(), Date.now()
      );
      return this.getDiscountTypeById(id);
    } catch (error) {
      logger.error('Error creating discount type:', error);
      throw new DatabaseError('Failed to create discount type');
    }
  }

  async updateDiscountType(id: string, data: any): Promise<any | null> {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
      if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
      if (data.code !== undefined) { fields.push('code = ?'); values.push(data.code); }
      if (data.discountType !== undefined) { fields.push('discount_type = ?'); values.push(data.discountType); }
      if (data.discountValue !== undefined) { fields.push('discount_value = ?'); values.push(data.discountValue); }
      if (data.minPurchase !== undefined) { fields.push('min_purchase = ?'); values.push(data.minPurchase); }
      if (data.maxDiscount !== undefined) { fields.push('max_discount = ?'); values.push(data.maxDiscount); }
      if (data.appliesTo !== undefined) { fields.push('applies_to = ?'); values.push(data.appliesTo); }
      if (data.applicableIds !== undefined) { fields.push('applicable_ids = ?'); values.push(JSON.stringify(data.applicableIds)); }
      if (data.requiresApproval !== undefined) { fields.push('requires_approval = ?'); values.push(data.requiresApproval ? 1 : 0); }
      if (data.approvalThreshold !== undefined) { fields.push('approval_threshold = ?'); values.push(data.approvalThreshold); }
      if (data.requiresEmployeeId !== undefined) { fields.push('requires_employee_id = ?'); values.push(data.requiresEmployeeId ? 1 : 0); }
      if (data.displayOrder !== undefined) { fields.push('display_order = ?'); values.push(data.displayOrder); }
      if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
      if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon); }
      if (data.showInPos !== undefined) { fields.push('show_in_pos = ?'); values.push(data.showInPos ? 1 : 0); }
      if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }

      if (fields.length === 0) return this.getDiscountTypeById(id);

      fields.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);

      this.db.prepare(`UPDATE discount_types SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.getDiscountTypeById(id);
    } catch (error) {
      logger.error('Error updating discount type:', error);
      throw new DatabaseError('Failed to update discount type');
    }
  }

  async deleteDiscountType(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM discount_types WHERE id = ?').run(id);
      return result.changes > 0;
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
      discountValue: row.discount_value,
      minPurchase: row.min_purchase || 0,
      maxDiscount: row.max_discount,
      appliesTo: row.applies_to,
      applicableIds: row.applicable_ids ? JSON.parse(row.applicable_ids) : [],
      requiresApproval: Boolean(row.requires_approval),
      approvalThreshold: row.approval_threshold,
      requiresEmployeeId: Boolean(row.requires_employee_id),
      displayOrder: row.display_order,
      color: row.color,
      icon: row.icon,
      showInPos: Boolean(row.show_in_pos),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===== Promo Codes Operations =====

  async getAllPromoCodes(): Promise<any[]> {
    try {
      const rows = this.db.prepare(
        `SELECT pc.*, u.name as created_by_name 
         FROM promo_codes pc 
         LEFT JOIN users u ON pc.created_by = u.id 
         ORDER BY pc.created_at DESC`
      ).all() as any[];
      return rows.map(r => this.mapPromoCodeRow(r));
    } catch (error) {
      logger.error('Error getting promo codes:', error);
      throw new DatabaseError('Failed to get promo codes');
    }
  }

  async getPromoCodeById(id: string): Promise<any | null> {
    try {
      const row = this.db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as any;
      return row ? this.mapPromoCodeRow(row) : null;
    } catch (error) {
      logger.error('Error getting promo code:', error);
      throw new DatabaseError('Failed to get promo code');
    }
  }

  async getPromoCodeByCode(code: string): Promise<any | null> {
    try {
      const row = this.db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(code.toUpperCase()) as any;
      return row ? this.mapPromoCodeRow(row) : null;
    } catch (error) {
      logger.error('Error getting promo code by code:', error);
      throw new DatabaseError('Failed to get promo code');
    }
  }

  async createPromoCode(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO promo_codes (
          id, code, name, description, discount_type, discount_value,
          buy_quantity, get_quantity, get_product_id,
          min_purchase, max_discount, min_items,
          applies_to, applicable_ids, excluded_ids,
          first_order_only, specific_customers, customer_groups,
          max_uses, max_uses_per_customer, current_uses,
          starts_at, expires_at, stackable, priority, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, data.code.toUpperCase(), data.name, data.description, data.discountType, data.discountValue,
        data.buyQuantity, data.getQuantity, data.getProductId,
        data.minPurchase || 0, data.maxDiscount, data.minItems || 0,
        data.appliesTo || 'all', JSON.stringify(data.applicableIds || []), JSON.stringify(data.excludedIds || []),
        data.firstOrderOnly ? 1 : 0, JSON.stringify(data.specificCustomers || []), JSON.stringify(data.customerGroups || []),
        data.maxUses, data.maxUsesPerCustomer || 1, 0,
        new Date(data.startsAt).getTime(), data.expiresAt ? new Date(data.expiresAt).getTime() : null,
        data.stackable ? 1 : 0, data.priority || 0, data.isActive !== false ? 1 : 0, data.createdBy,
        Date.now(), Date.now()
      );
      return this.getPromoCodeById(id);
    } catch (error) {
      logger.error('Error creating promo code:', error);
      throw new DatabaseError('Failed to create promo code');
    }
  }

  async updatePromoCode(id: string, data: any): Promise<any | null> {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (data.code !== undefined) { fields.push('code = ?'); values.push(data.code.toUpperCase()); }
      if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
      if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
      if (data.discountType !== undefined) { fields.push('discount_type = ?'); values.push(data.discountType); }
      if (data.discountValue !== undefined) { fields.push('discount_value = ?'); values.push(data.discountValue); }
      if (data.minPurchase !== undefined) { fields.push('min_purchase = ?'); values.push(data.minPurchase); }
      if (data.maxDiscount !== undefined) { fields.push('max_discount = ?'); values.push(data.maxDiscount); }
      if (data.maxUses !== undefined) { fields.push('max_uses = ?'); values.push(data.maxUses); }
      if (data.maxUsesPerCustomer !== undefined) { fields.push('max_uses_per_customer = ?'); values.push(data.maxUsesPerCustomer); }
      if (data.startsAt !== undefined) { fields.push('starts_at = ?'); values.push(new Date(data.startsAt).getTime()); }
      if (data.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(data.expiresAt ? new Date(data.expiresAt).getTime() : null); }
      if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }
      if (data.stackable !== undefined) { fields.push('stackable = ?'); values.push(data.stackable ? 1 : 0); }

      if (fields.length === 0) return this.getPromoCodeById(id);

      fields.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);

      this.db.prepare(`UPDATE promo_codes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.getPromoCodeById(id);
    } catch (error) {
      logger.error('Error updating promo code:', error);
      throw new DatabaseError('Failed to update promo code');
    }
  }

  async deletePromoCode(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Error deleting promo code:', error);
      throw new DatabaseError('Failed to delete promo code');
    }
  }

  async incrementPromoCodeUsage(id: string): Promise<void> {
    try {
      this.db.prepare(
        'UPDATE promo_codes SET current_uses = current_uses + 1, updated_at = ? WHERE id = ?'
      ).run(Date.now(), id);
    } catch (error) {
      logger.error('Error incrementing promo code usage:', error);
    }
  }

  async getPromoCodeUsageByCustomer(promoCodeId: string, customerId: string): Promise<number> {
    try {
      const result = this.db.prepare(
        'SELECT COUNT(*) as count FROM discount_usage WHERE promo_code_id = ? AND customer_id = ?'
      ).get(promoCodeId, customerId) as any;
      return result?.count || 0;
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
      discountValue: row.discount_value,
      buyQuantity: row.buy_quantity,
      getQuantity: row.get_quantity,
      getProductId: row.get_product_id,
      minPurchase: row.min_purchase || 0,
      maxDiscount: row.max_discount,
      minItems: row.min_items || 0,
      appliesTo: row.applies_to,
      applicableIds: row.applicable_ids ? JSON.parse(row.applicable_ids) : [],
      excludedIds: row.excluded_ids ? JSON.parse(row.excluded_ids) : [],
      firstOrderOnly: Boolean(row.first_order_only),
      specificCustomers: row.specific_customers ? JSON.parse(row.specific_customers) : [],
      customerGroups: row.customer_groups ? JSON.parse(row.customer_groups) : [],
      maxUses: row.max_uses,
      maxUsesPerCustomer: row.max_uses_per_customer,
      currentUses: row.current_uses || 0,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      stackable: Boolean(row.stackable),
      priority: row.priority,
      isActive: Boolean(row.is_active),
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===== Employee Discounts Operations =====

  async getAllEmployeeDiscounts(): Promise<any[]> {
    try {
      const rows = this.db.prepare(
        `SELECT ed.*, u.name as user_name, u.email as user_email, a.name as approved_by_name
         FROM employee_discounts ed
         LEFT JOIN users u ON ed.user_id = u.id
         LEFT JOIN users a ON ed.approved_by = a.id
         ORDER BY ed.created_at DESC`
      ).all() as any[];
      return rows.map(r => this.mapEmployeeDiscountRow(r));
    } catch (error) {
      logger.error('Error getting employee discounts:', error);
      throw new DatabaseError('Failed to get employee discounts');
    }
  }

  async getEmployeeDiscountByUser(userId: string): Promise<any | null> {
    try {
      const row = this.db.prepare(
        `SELECT ed.*, u.name as user_name, u.email as user_email
         FROM employee_discounts ed
         LEFT JOIN users u ON ed.user_id = u.id
         WHERE ed.user_id = ?`
      ).get(userId) as any;
      return row ? this.mapEmployeeDiscountRow(row) : null;
    } catch (error) {
      logger.error('Error getting employee discount:', error);
      throw new DatabaseError('Failed to get employee discount');
    }
  }

  async upsertEmployeeDiscount(data: any): Promise<any> {
    try {
      // Check if exists
      const existing = await this.getEmployeeDiscountByUser(data.userId);
      
      if (existing) {
        // Update
        this.db.prepare(
          `UPDATE employee_discounts SET
            discount_percentage = ?, max_discount_amount = ?,
            requires_manager_approval_above = ?, allowed_categories = ?,
            is_active = ?, approved_by = ?, approved_at = ?, updated_at = ?
          WHERE user_id = ?`
        ).run(
          data.discountPercentage || 10, data.maxDiscountAmount,
          data.requiresManagerApprovalAbove, JSON.stringify(data.allowedCategories || []),
          data.isActive !== false ? 1 : 0, data.approvedBy, data.approvedAt, Date.now(),
          data.userId
        );
      } else {
        // Insert
        const id = crypto.randomUUID();
        this.db.prepare(
          `INSERT INTO employee_discounts (
            id, user_id, discount_percentage, max_discount_amount,
            requires_manager_approval_above, allowed_categories,
            is_active, approved_by, approved_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, data.userId, data.discountPercentage || 10, data.maxDiscountAmount,
          data.requiresManagerApprovalAbove, JSON.stringify(data.allowedCategories || []),
          data.isActive !== false ? 1 : 0, data.approvedBy, data.approvedAt, Date.now(), Date.now()
        );
      }
      
      return this.getEmployeeDiscountByUser(data.userId);
    } catch (error) {
      logger.error('Error upserting employee discount:', error);
      throw new DatabaseError('Failed to create/update employee discount');
    }
  }

  async deleteEmployeeDiscount(userId: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM employee_discounts WHERE user_id = ?').run(userId);
      return result.changes > 0;
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
      discountPercentage: row.discount_percentage,
      maxDiscountAmount: row.max_discount_amount,
      currentMonthUsage: row.current_month_usage || 0,
      lastResetAt: row.last_reset_at,
      requiresManagerApprovalAbove: row.requires_manager_approval_above,
      allowedCategories: row.allowed_categories ? JSON.parse(row.allowed_categories) : [],
      isActive: Boolean(row.is_active),
      approvedBy: row.approved_by,
      approvedByName: row.approved_by_name,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      const params: unknown[] = [];

      if (filters?.orderId) {
        query += ' AND du.order_id = ?';
        params.push(filters.orderId);
      }
      if (filters?.customerId) {
        query += ' AND du.customer_id = ?';
        params.push(filters.customerId);
      }
      if (filters?.startDate) {
        query += ' AND du.applied_at >= ?';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        query += ' AND du.applied_at <= ?';
        params.push(filters.endDate);
      }

      query += ' ORDER BY du.applied_at DESC LIMIT 500';

      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map(r => ({
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
        discountValue: r.discount_value,
        discountAmount: r.discount_amount,
        manualReason: r.manual_reason,
        customerId: r.customer_id,
        customerEmail: r.customer_email,
        requiresApproval: Boolean(r.requires_approval),
        approvedBy: r.approved_by,
        approvedByName: r.approved_by_name,
        approvalStatus: r.approval_status,
        appliedBy: r.applied_by,
        appliedByName: r.applied_by_name,
        appliedAt: r.applied_at,
      }));
    } catch (error) {
      logger.error('Error getting discount usage:', error);
      throw new DatabaseError('Failed to get discount usage');
    }
  }

  async logDiscountUsage(data: any): Promise<any> {
    try {
      const id = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO discount_usage (
          id, order_id, quote_id, discount_source,
          discount_type_id, promo_code_id, employee_discount_id,
          discount_code, discount_name, discount_type, discount_value, discount_amount,
          manual_reason, customer_id, customer_email,
          requires_approval, approved_by, approval_status, applied_by, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, data.orderId, data.quoteId, data.discountSource,
        data.discountTypeId, data.promoCodeId, data.employeeDiscountId,
        data.discountCode, data.discountName, data.discountType, data.discountValue, data.discountAmount,
        data.manualReason, data.customerId, data.customerEmail,
        data.requiresApproval ? 1 : 0, data.approvedBy, data.approvalStatus || 'none', data.appliedBy, Date.now()
      );
      return this.db.prepare('SELECT * FROM discount_usage WHERE id = ?').get(id);
    } catch (error) {
      logger.error('Error logging discount usage:', error);
      throw new DatabaseError('Failed to log discount usage');
    }
  }

  async getDiscountStats(filters?: { startDate?: number; endDate?: number }): Promise<any> {
    try {
      let whereClause = '';
      const params: unknown[] = [];

      if (filters?.startDate) {
        whereClause += ' AND applied_at >= ?';
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        whereClause += ' AND applied_at <= ?';
        params.push(filters.endDate);
      }

      const result = this.db.prepare(
        `SELECT
          COUNT(*) as total_discounts,
          COALESCE(SUM(discount_amount), 0) as total_discount_amount,
          SUM(CASE WHEN discount_source = 'promo_code' THEN 1 ELSE 0 END) as promo_code_count,
          COALESCE(SUM(CASE WHEN discount_source = 'promo_code' THEN discount_amount ELSE 0 END), 0) as promo_code_amount,
          SUM(CASE WHEN discount_source = 'quick_discount' THEN 1 ELSE 0 END) as quick_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'quick_discount' THEN discount_amount ELSE 0 END), 0) as quick_discount_amount,
          SUM(CASE WHEN discount_source = 'employee' THEN 1 ELSE 0 END) as employee_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'employee' THEN discount_amount ELSE 0 END), 0) as employee_discount_amount,
          SUM(CASE WHEN discount_source = 'manual' THEN 1 ELSE 0 END) as manual_discount_count,
          COALESCE(SUM(CASE WHEN discount_source = 'manual' THEN discount_amount ELSE 0 END), 0) as manual_discount_amount
        FROM discount_usage
        WHERE 1=1 ${whereClause}`
      ).get(...params) as any;

      return {
        totalDiscounts: result.total_discounts || 0,
        totalDiscountAmount: result.total_discount_amount || 0,
        promoCodeCount: result.promo_code_count || 0,
        promoCodeAmount: result.promo_code_amount || 0,
        quickDiscountCount: result.quick_discount_count || 0,
        quickDiscountAmount: result.quick_discount_amount || 0,
        employeeDiscountCount: result.employee_discount_count || 0,
        employeeDiscountAmount: result.employee_discount_amount || 0,
        manualDiscountCount: result.manual_discount_count || 0,
        manualDiscountAmount: result.manual_discount_amount || 0,
      };
    } catch (error) {
      logger.error('Error getting discount stats:', error);
      throw new DatabaseError('Failed to get discount stats');
    }
  }
}
