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
      const result = this.db.prepare('SELECT 1 as test').get();
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

      // Insert order items
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

  close(): void {
    this.db.close();
    logger.info('SQLite connection closed');
  }
}
