import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../../utils/logger';
import { DatabaseError, ValidationError } from '../../utils/errors';
import { escapeLike } from './like';
import { DbRow, asRows } from './types';
import { bucketOrdersByLocalHour } from './timezoneBucketing';
import type {
  AuditLogQuery,
  DrawerVarianceByRegister,
  NoSaleCount,
  PaymentMix,
  RegisterFilter,
  RegisterHourly,
  ReportRange,
  ReturnsByReason,
  ReturnsTotals,
  SalesByCashier,
  SalesByDay,
  SalesByLocation,
  SalesByRegister,
  SalesTotals,
  TopProduct,
} from './reports.types';

export interface SQLiteConfig {
  filename: string;
}

export interface TerminalTransactionCreate {
  amount: number;
  currency: string;
  provider: string;
  chargeId: string;
  status: string;
  readerId?: string;
  startedAt: number;
}

export interface TerminalTransactionUpdate {
  status?: string;
  authCode?: string;
  errorMessage?: string;
  orderId?: string;
  durationMs?: number;
}


/** Turn a `store_credits` row into the camelCase DTO the API publishes. */
export function mapStoreCreditRow(row: DbRow): DbRow {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerEmail: row.customer_email,
    returnId: row.return_id,
    code: row.code,
    originalAmount: Number(row.original_amount),
    remainingAmount: Number(row.remaining_amount),
    status: row.status,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    usedAt: row.used_at ?? null,
    usedOrderId: row.used_order_id,
  };
}


/**
 * Turn an `orders` row into the camelCase DTO the API publishes.
 *
 * The counterpart of `mapOrderRow` in the Postgres adapter, and extracted for
 * the same reason: this shape was written out inline at five call sites, so a
 * new column had to be remembered five times. The card fields were already
 * missing from every read path here.
 */
export function mapOrderRow(order: DbRow): DbRow {
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
    cardTransactionId: order.card_transaction_id ?? null,
    cardAuthCode: order.card_auth_code ?? null,
    // Null on card and other tenders, and on orders predating the columns.
    amountTendered: order.amount_tendered ?? null,
    changeGiven: order.change_given ?? null,
    registerId: order.register_id ?? null,
    cashierUserId: order.cashier_user_id ?? null,
    // Present only where the read joined them; a receipt prints these, a list
    // does not need them.
    registerDisplayCode: order.register_display_code ?? null,
    cashierName: order.cashier_name ?? null,
    drawerSessionId: order.drawer_session_id ?? null,
    overrideByUserId: order.override_by_user_id ?? null,
  };
}


/** Turn a `cash_drawer_sessions` row into the camelCase DTO the API publishes. */
export function mapDrawerSessionRow(row: DbRow): DbRow {
  const money = (value: unknown) => (value == null ? null : Number(value));

  return {
    id: row.id,
    registerId: row.register_id ?? null,
    // Only populated when the query joins `registers`; a bare row read (e.g.
    // right after INSERT/UPDATE) leaves these null rather than stale.
    registerName: row.register_name ?? null,
    registerDisplayCode: row.register_display_code ?? null,
    openedBy: row.opened_by,
    openedByName: row.opened_by_name ?? null,
    closedBy: row.closed_by,
    closedByName: row.closed_by_name ?? null,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? null,
    openingFloat: money(row.opening_float),
    expectedCash: money(row.expected_cash),
    countedCash: money(row.counted_cash),
    variance: money(row.variance),
    notes: row.notes ?? null,
    status: row.status,
  };
}


/** Turn a `payments` row into the camelCase DTO the API publishes. */
export function mapPaymentRow(row: DbRow): DbRow {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    amount: Number(row.amount),
    reference: row.reference ?? null,
    createdAt: row.created_at,
    registerId: row.register_id ?? null,
  };
}


/** Turn a `product_variants` row into the camelCase DTO the API publishes. */
export function mapVariantRow(row: DbRow): DbRow {
  return {
    id: row.id,
    size: row.size,
    color: row.color,
    priceOverride: row.price_override ?? null,
    priceDelta: row.price_delta ?? null,
    sku: row.sku,
    barcode: row.barcode,
    stock: row.stock,
    enabled: Boolean(row.enabled),
    lowStockThreshold: row.low_stock_threshold ?? null,
  };
}

/** Turn a `locations` row into the camelCase DTO the API publishes. */
function mapLocation(row: DbRow): DbRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: row.name,
    slug: row.slug,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    timezone: row.timezone,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Turn a `registers` row into the camelCase DTO the API publishes.
 *
 * The five flag columns are coerced through `Boolean(...)` rather than
 * passed through raw: SQLite stores them as `0`/`1`, and the Postgres
 * adapter's equivalent mapper must produce the exact same JSON shape from
 * its native `true`/`false` columns, or the same register serializes
 * differently per environment.
 */
function mapRegister(row: DbRow): DbRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    locationId: String(row.location_id),
    name: row.name,
    registerNumber: Number(row.register_number),
    displayCode: row.display_code,
    placement: row.placement ?? null,
    type: row.type,
    hasCashDrawer: Boolean(row.has_cash_drawer),
    acceptsCash: Boolean(row.accepts_cash),
    canRefund: Boolean(row.can_refund),
    canOpenDrawerNoSale: Boolean(row.can_open_drawer_no_sale),
    requireSignIn: Boolean(row.require_sign_in),
    idleLockSeconds: Number(row.idle_lock_seconds),
    terminalProvider: row.terminal_provider ?? null,
    terminalDeviceId: row.terminal_device_id ?? null,
    status: row.status,
    lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Turn a `register_credentials` row into the camelCase DTO the service layer
 * consumes. Includes the hash columns — this is an internal shape used only
 * by `services/registerEnrolment.ts` for its own `bcrypt.compare` calls,
 * never returned directly by a route.
 */
function mapRegisterCredential(row: DbRow): DbRow {
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    pairingCodePrefix: row.pairing_code_prefix,
    pairingCodeHash: row.pairing_code_hash,
    pairingExpiresAt: Number(row.pairing_expires_at),
    tokenPrefix: row.token_prefix ?? null,
    tokenHash: row.token_hash ?? null,
    enrolledAt: row.enrolled_at == null ? null : Number(row.enrolled_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    revokedBy: row.revoked_by ?? null,
    revokeReason: row.revoke_reason ?? null,
    createdBy: row.created_by ?? null,
    createdAt: Number(row.created_at),
  };
}

/**
 * The organization every row implicitly belongs to when `org_id` is NULL —
 * see migration 014's note on `users.org_id`. Filtering PIN candidates by org
 * has to fall back the same way `authenticate` does (`auth.ts`,
 * `DEFAULT_ORG_ID`), or every existing user — none of whom have `org_id` set
 * — would be invisible to the PIN uniqueness check and to sign-in.
 */
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Turn a `users` row into the camelCase shape `services/pins.ts` and
 * `services/registerShifts.ts` need. Includes `pinHash` — like
 * `mapRegisterCredential` above, this is an internal shape for the service
 * layer's own `bcrypt.compare` calls, and must never be returned directly by
 * a route.
 */
function mapUserPin(row: DbRow): DbRow {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    status: row.status,
    orgId: row.org_id ?? null,
    pinHash: row.pin_hash ?? null,
    pinSetAt: row.pin_set_at == null ? null : Number(row.pin_set_at),
    pinFailedCount: Number(row.pin_failed_count ?? 0),
    pinLockedUntil: row.pin_locked_until == null ? null : Number(row.pin_locked_until),
    canOverride: Boolean(row.can_override),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    createdAt: Number(row.created_at),
  };
}

/** Turn a `register_shifts` row into the camelCase DTO routes and services consume. */
function mapRegisterShift(row: DbRow): DbRow {
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    userId: String(row.user_id),
    startedAt: Number(row.started_at),
    lastActivityAt: Number(row.last_activity_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    endReason: row.end_reason ?? null,
    createdAt: Number(row.created_at),
  };
}

/**
 * Turn a `register_overrides` row into the camelCase shape
 * `services/registerOverrides.ts` needs. Includes `grantHash` — like
 * `mapRegisterCredential`, this is an internal shape for the service layer's
 * own `bcrypt.compare` calls, and must never be returned directly by a
 * route. The admin listing route (`GET /api/registers/overrides`) selects
 * its own safe column list instead of using this mapper.
 */
function mapRegisterOverride(row: DbRow): DbRow {
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    shiftId: row.shift_id == null ? null : String(row.shift_id),
    approverUserId: String(row.approver_user_id),
    requestedByUserId: row.requested_by_user_id == null ? null : String(row.requested_by_user_id),
    action: row.action,
    grantPrefix: row.grant_prefix,
    grantHash: row.grant_hash,
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
    entity: row.entity ?? null,
    entityId: row.entity_id ?? null,
    beforeValue: row.before_value ?? null,
    afterValue: row.after_value ?? null,
    reason: row.reason ?? null,
    createdAt: Number(row.created_at),
    // Joined for display. This log exists to answer "who authorised what", and
    // a table of raw UUIDs cannot answer it.
    approverName: row.approver_name ?? null,
    requestedByName: row.requested_by_name ?? null,
    registerDisplayCode: row.register_display_code ?? null,
  };
}

/** The safe projection of a `register_overrides` row for the admin listing route — never `grant_hash`. */
function mapRegisterOverrideSummary(row: DbRow): DbRow {
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    shiftId: row.shift_id == null ? null : String(row.shift_id),
    approverUserId: String(row.approver_user_id),
    requestedByUserId: row.requested_by_user_id == null ? null : String(row.requested_by_user_id),
    action: row.action,
    grantPrefix: row.grant_prefix,
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
    entity: row.entity ?? null,
    entityId: row.entity_id ?? null,
    beforeValue: row.before_value ?? null,
    afterValue: row.after_value ?? null,
    reason: row.reason ?? null,
    createdAt: Number(row.created_at),
  };
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
        // See the Postgres adapter: null until a second organization exists.
        orgId: user.org_id ?? null,
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
  /** See the Postgres adapter: `limit` is opt-in, with no default cap. */
  async getAllProducts(query: {
    q?: string;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ products: DbRow[]; total: number }> {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.q) {
        // See the Postgres adapter: unescaped, a search for `%` matched the
        // whole catalog. SQLite additionally needs the ESCAPE clause spelled
        // out — unlike Postgres it has no default escape character, so the
        // backslashes would otherwise be matched as literal backslashes.
        const like = `%${escapeLike(query.q)}%`;
        conditions.push(`(
          p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR p.barcode LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM product_variants v
            WHERE v.product_id = p.id
              AND (v.sku LIKE ? ESCAPE '\\' COLLATE NOCASE
                   OR v.barcode LIKE ? ESCAPE '\\' COLLATE NOCASE)
          )
        )`);
        params.push(like, like, like, like);
      }

      if (query.category) {
        conditions.push('p.category = ?');
        params.push(query.category);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const { total } = this.db
        .prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
        .get(...params) as { total: number };

      let paging = '';
      const pagingParams: unknown[] = [];
      if (query.limit != null) {
        paging += ' LIMIT ?';
        pagingParams.push(query.limit);
      }
      if (query.offset != null) {
        // SQLite requires a LIMIT before OFFSET; -1 means "no limit".
        if (query.limit == null) paging += ' LIMIT -1';
        paging += ' OFFSET ?';
        pagingParams.push(query.offset);
      }

      const products = this.db
        .prepare(`SELECT p.* FROM products p ${where} ORDER BY p.name ASC${paging}`)
        .all(...params, ...pagingParams) as DbRow[];

      // Get variants for each product
      const productsWithVariants = products.map((product) => {
        const variants = this.db
          .prepare('SELECT * FROM product_variants WHERE product_id = ?')
          .all(product.id) as DbRow[];

        return {
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          basePrice: product.base_price,
          image: product.image,
          barcode: product.barcode,
          variants: variants.map(mapVariantRow),
          createdAt: product.created_at,
          updatedAt: product.updated_at,
        };
      });

      return { products: productsWithVariants, total };
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
        .all(id) as DbRow[];

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        basePrice: product.base_price,
        image: product.image,
        barcode: product.barcode,
        variants: variants.map(mapVariantRow),
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
          product.name ?? null,
          product.description ?? null,
          product.category ?? null,
          product.basePrice ?? null,
          product.image ?? null,
          product.barcode ?? null,
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
      if (Array.isArray(product.variants) && product.variants.length > 0) {
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

          variants.push(mapVariantRow(createdVariant));
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

  async updateProduct(id: string, product: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          // COALESCE for the same reason as the Postgres adapter: every field on
          // the update schema is optional, and writing the parameters straight
          // through wipes whatever the caller did not send.
          `UPDATE products 
           SET name = COALESCE(?, name),
               description = COALESCE(?, description),
               category = COALESCE(?, category),
               base_price = COALESCE(?, base_price),
               image = COALESCE(?, image),
               barcode = COALESCE(?, barcode),
               updated_at = ?
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
          `INSERT INTO orders (created_at, subtotal, discount_total, tax_total, total, payment_method, customer_email, customer_phone, card_transaction_id, card_auth_code, amount_tendered, change_given, register_id, cashier_user_id, drawer_session_id, override_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          now,
          order.subtotal,
          order.discountTotal || 0,
          order.taxTotal || 0,
          order.total,
          order.paymentMethod,
          order.customerEmail,
          order.customerPhone,
          order.cardTransactionId ?? null,
          order.cardAuthCode ?? null,
          order.amountTendered ?? null,
          order.changeGiven ?? null,
          order.registerId ?? null,
          order.cashierUserId ?? null,
          order.drawerSessionId ?? null,
          order.overrideByUserId ?? null
        );

      const createdOrder = this.db
        .prepare('SELECT * FROM orders WHERE rowid = ?')
        .get(orderResult.lastInsertRowid) as any;

      // Insert order items and update stock
      const items = [];
      if (Array.isArray(order.items) && order.items.length > 0) {
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
            // Conditional for the same reason as the Postgres adapter: clamping
            // at zero reported success on an oversell instead of failing.
            const stockResult = this.db
              .prepare(
                `UPDATE product_variants 
                 SET stock = stock - ?
                 WHERE id = ? AND stock >= ?`
              )
              .run(item.quantity, item.variantId, item.quantity);

            if (stockResult.changes === 0) {
              throw new ValidationError(
                `Not enough stock for "${item.nameSnapshot ?? item.productId}"`
              );
            }
          }
        }
      }

      // See the Postgres adapter: payments and any store credit they spend belong
      // in the same transaction as the order and its stock movements.
      const payments: DbRow[] = [];
      if (Array.isArray(order.payments)) {
        for (const payment of order.payments as Array<Record<string, unknown>>) {
          if (payment.method === 'store_credit') {
            const redeemed = this.db
              .prepare(
                `UPDATE store_credits
                 SET remaining_amount = remaining_amount - ?,
                     status = CASE WHEN remaining_amount - ? <= 0 THEN 'used' ELSE status END,
                     used_at = CASE WHEN remaining_amount - ? <= 0 THEN ? ELSE used_at END,
                     used_order_id = ?
                 WHERE UPPER(code) = UPPER(?)
                   AND status = 'active'
                   AND remaining_amount >= ?
                   AND (expires_at IS NULL OR expires_at > ?)`
              )
              .run(
                payment.amount, payment.amount, payment.amount, now,
                createdOrder.id, payment.reference, payment.amount, now
              );

            if (redeemed.changes === 0) {
              throw new ValidationError(
                'That store credit is not available for the amount requested'
              );
            }
          }

          const paymentId = crypto.randomUUID();
          this.db
            .prepare(
              `INSERT INTO payments (id, order_id, method, amount, reference, created_at, register_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              paymentId,
              createdOrder.id,
              payment.method,
              payment.amount,
              payment.reference ?? null,
              now,
              order.registerId ?? null
            );

          payments.push(
            mapPaymentRow(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as DbRow)
          );
        }
      }

      return {
        ...mapOrderRow(createdOrder),
        items,
        payments,
      };
    });

    try {
      return transaction();
    } catch (error) {
      // A stock conflict is the caller's problem: keep it a 400.
      if (error instanceof ValidationError) throw error;

      logger.error('Error creating order:', error);
      throw new DatabaseError('Failed to create order');
    }
  }

  async getAllOrders(): Promise<DbRow[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders ORDER BY created_at DESC')
        .all() as DbRow[];

      // Get all order items
      const itemsMap = new Map<string, unknown[]>();
      const orderIds = orders.map(o => o.id);
      
      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        const items = this.db
          .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`)
          .all(...orderIds) as DbRow[];
        
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
        ...mapOrderRow(order),
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
        // Joined so a receipt can name the till and the cashier rather than
        // print two UUIDs. LEFT JOINs: an order predating registers, or one
        // rung before PIN sign-in existed, still has to render.
        .prepare(
          `SELECT o.*,
                  r.display_code AS register_display_code,
                  u.name AS cashier_name
           FROM orders o
           LEFT JOIN registers r ON r.id = o.register_id
           LEFT JOIN users u ON u.id = o.cashier_user_id
           WHERE o.id = ?`
        )
        .get(id) as any;

      if (!order) {
        return null;
      }

      const items = this.db
        .prepare('SELECT * FROM order_items WHERE order_id = ?')
        .all(id) as DbRow[];

      // See the Postgres adapter: a receipt needs the tender breakdown, not just
      // the 'Split' summary.
      const payments = this.db
        .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at')
        .all(id) as DbRow[];

      return {
        ...mapOrderRow(order),
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
        payments: payments.map(mapPaymentRow),
      };
    } catch (error) {
      logger.error('Error getting order by ID:', error);
      throw new DatabaseError('Failed to get order');
    }
  }

  // Customer Operations
  async getAllCustomers(): Promise<DbRow[]> {
    try {
      const customers = this.db
        .prepare('SELECT * FROM customers ORDER BY name ASC')
        .all() as DbRow[];

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
        .all(id) as DbRow[];

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
        .all(id) as DbRow[];

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
  async getAllServices(): Promise<DbRow[]> {
    try {
      const services = this.db
        .prepare('SELECT * FROM services ORDER BY name ASC')
        .all() as DbRow[];

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
  async getAllUsers(): Promise<DbRow[]> {
    try {
      const users = this.db
        .prepare('SELECT * FROM users ORDER BY name ASC')
        .all() as DbRow[];

      return users.map((u) => {
        // Get roles for user
        const roleIds = this.db
          .prepare('SELECT role_id FROM user_roles WHERE user_id = ?')
          .all(u.id) as DbRow[];
        
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
      if (Array.isArray(user.roleIds) && user.roleIds.length > 0) {
        for (const roleId of asRows(user.roleIds)) {
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
      // Whether this person may approve a manager override. Without a way to
      // set it, `can_override` would be false for everybody and the override
      // flow would be unreachable in production.
      if (user.canOverride !== undefined) {
        updates.push('can_override = ?');
        values.push(user.canOverride ? 1 : 0);
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
        for (const roleId of asRows(user.roleIds)) {
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
  async getAllRoles(): Promise<DbRow[]> {
    try {
      const roles = this.db
        .prepare('SELECT * FROM roles ORDER BY name ASC')
        .all() as DbRow[];

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

  /**
   * See the Postgres counterpart. `audit_logs.timestamp` is epoch milliseconds
   * here, so the date filters compare the parameter directly rather than going
   * through `to_timestamp`.
   */
  async getAuditLogs(options?: AuditLogQuery): Promise<{ logs: DbRow[]; total: number }> {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options?.userId) {
        conditions.push('al.user_id = ?');
        params.push(options.userId);
      }
      if (options?.entity) {
        conditions.push('al.entity = ?');
        params.push(options.entity);
      }
      if (options?.action) {
        conditions.push('al.action = ?');
        params.push(options.action);
      }
      if (options?.from !== undefined) {
        conditions.push('al.timestamp >= ?');
        params.push(options.from);
      }
      if (options?.to !== undefined) {
        conditions.push('al.timestamp <= ?');
        params.push(options.to);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const counted = this.db
        .prepare(`SELECT COUNT(*) as total FROM audit_logs al ${where}`)
        .get(...params) as DbRow;

      const logs = this.db
        .prepare(
          `SELECT al.*, u.name as user_name, u.email as user_email
           FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           ${where}
           ORDER BY al.timestamp DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, options?.limit ?? 50, options?.offset ?? 0) as DbRow[];

      return {
        total: Number(counted.total ?? 0),
        logs: logs.map((l) => ({
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
        })),
      };
    } catch (error) {
      logger.error('Error getting audit logs:', error);
      throw new DatabaseError('Failed to get audit logs');
    }
  }

  // ===== Quote Operations =====
  async getAllQuotes(): Promise<DbRow[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           ORDER BY q.created_at DESC`
        )
        .all() as DbRow[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as DbRow[];

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
        .all(id) as DbRow[];

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

  async getQuotesByCustomer(customerId: string): Promise<DbRow[]> {
    try {
      const quotes = this.db
        .prepare(
          `SELECT q.*, c.name as customer_name, c.email as customer_email
           FROM quotes q
           LEFT JOIN customers c ON q.customer_id = c.id
           WHERE q.customer_id = ?
           ORDER BY q.created_at DESC`
        )
        .all(customerId) as DbRow[];

      return quotes.map((q) => {
        const items = this.db
          .prepare(
            `SELECT qi.*, s.name as service_name
             FROM quote_items qi
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quote_id = ?`
          )
          .all(q.id) as DbRow[];

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
      if (Array.isArray(quote.items) && quote.items.length > 0) {
        for (const item of asRows(quote.items)) {
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
        for (const item of asRows(quote.items)) {
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
  async getOrdersByCustomerEmail(email: string): Promise<DbRow[]> {
    try {
      const orders = this.db
        .prepare('SELECT * FROM orders WHERE customer_email = ? ORDER BY created_at DESC')
        .all(email) as DbRow[];

      return orders.map((order) => {
        const items = this.db
          .prepare('SELECT * FROM order_items WHERE order_id = ?')
          .all(order.id) as DbRow[];

        return {
          ...mapOrderRow(order),
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
  async getAllApiKeys(): Promise<DbRow[]> {
    try {
      const keys = this.db
        .prepare(
          `SELECT ak.*, u.name as created_by_name, u.email as created_by_email
           FROM api_keys ak
           LEFT JOIN users u ON ak.created_by = u.id
           ORDER BY ak.created_at DESC`
        )
        .all() as DbRow[];

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

  async getAllReturns(filters?: { status?: string; startDate?: number; endDate?: number; customerId?: string }): Promise<DbRow[]> {
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

      const returns = this.db.prepare(query).all(...params) as DbRow[];

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
      ).all(id) as DbRow[];

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

  async getReturnsByOrder(orderId: string): Promise<DbRow[]> {
    try {
      const returns = this.db.prepare(
        `SELECT r.*, u.name as created_by_name
         FROM returns r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.original_order_id = ?
         ORDER BY r.created_at DESC`
      ).all(orderId) as any[];

      const result = returns.map(r => this.mapReturnRow(r));

      // Items for every return in one query. See the Postgres adapter: this is
      // on the return path, where `originalOrderItemId` is what stops the same
      // order line being refunded twice.
      //
      // SQLite has no array parameter, so the placeholders are generated from
      // the id count — still one statement, and every value still bound.
      const returnIds = result.map(r => r.id as string);
      const itemsByReturn = new Map<string, unknown[]>();

      if (returnIds.length > 0) {
        const placeholders = returnIds.map(() => '?').join(', ');
        const items = this.db.prepare(
          `SELECT * FROM return_items WHERE return_id IN (${placeholders})`
        ).all(...returnIds) as DbRow[];

        for (const item of items) {
          const key = item.return_id as string;
          const bucket = itemsByReturn.get(key) ?? [];
          bucket.push({
            id: item.id,
            originalOrderItemId: item.original_order_item_id,
            productId: item.product_id,
            variantId: item.variant_id,
            nameSnapshot: item.name_snapshot,
            returnQuantity: item.return_quantity,
            unitPrice: item.unit_price,
            lineTotal: item.line_total,
          });
          itemsByReturn.set(key, bucket);
        }
      }

      for (const ret of result) {
        ret.items = itemsByReturn.get(ret.id as string) ?? [];
      }

      return result;
    } catch (error) {
      logger.error('Error getting returns by order:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  /** See the Postgres adapter: returns for many orders, without their items. */
  async getReturnSummariesByOrderIds(orderIds: string[]): Promise<DbRow[]> {
    if (orderIds.length === 0) return [];

    try {
      const placeholders = orderIds.map(() => '?').join(', ');
      const rows = this.db.prepare(
        `SELECT r.*, u.name as created_by_name
         FROM returns r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.original_order_id IN (${placeholders})
         ORDER BY r.created_at DESC`
      ).all(...orderIds) as DbRow[];

      return rows.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting returns for orders:', error);
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
          restock_items, restocking_fee, created_by, created_at, updated_at,
          register_id, cashier_user_id, override_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        Date.now(),
        returnData.registerId ?? null,
        returnData.cashierUserId ?? null,
        returnData.overrideByUserId ?? null
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

      return mapStoreCreditRow(
        this.db.prepare('SELECT * FROM store_credits WHERE id = ?').get(id) as DbRow
      );
    } catch (error) {
      logger.error('Error creating store credit:', error);
      throw new DatabaseError('Failed to create store credit');
    }
  }

  async getStoreCreditByCode(code: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare('SELECT * FROM store_credits WHERE UPPER(code) = UPPER(?)')
        .get(code) as DbRow | undefined;
      return row ? mapStoreCreditRow(row) : null;
    } catch (error) {
      logger.error('Error getting store credit:', error);
      throw new DatabaseError('Failed to get store credit');
    }
  }

  /**
   * Spend part or all of a store credit.
   *
   * The balance check is in the `WHERE` clause for the same reason as the
   * Postgres adapter: checking first and updating after lets two registers
   * spend the same code.
   */
  async redeemStoreCredit(code: string, amount: number, orderId?: string): Promise<DbRow | null> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare(
          `UPDATE store_credits
           SET remaining_amount = remaining_amount - ?,
               status = CASE WHEN remaining_amount - ? <= 0 THEN 'used' ELSE status END,
               used_at = CASE WHEN remaining_amount - ? <= 0 THEN ? ELSE used_at END,
               used_order_id = COALESCE(?, used_order_id)
           WHERE UPPER(code) = UPPER(?)
             AND status = 'active'
             AND remaining_amount >= ?
             AND (expires_at IS NULL OR expires_at > ?)`
        )
        .run(amount, amount, amount, now, orderId ?? null, code, amount, now);

      if (result.changes === 0) return null;
      return this.getStoreCreditByCode(code);
    } catch (error) {
      logger.error('Error redeeming store credit:', error);
      throw new DatabaseError('Failed to redeem store credit');
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
        // See the Postgres adapter. SQLite needs the ESCAPE clause spelled out,
        // having no default escape character of its own.
        query += " AND (o.id LIKE ? ESCAPE '\\' OR o.customer_email LIKE ? ESCAPE '\\')";
        const like = `%${escapeLike(filters.query)}%`;
        params.push(like, like);
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
        ...mapOrderRow(order),
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
      registerId: row.register_id ?? null,
      cashierUserId: row.cashier_user_id ?? null,
      overrideByUserId: row.override_by_user_id ?? null,
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

  // ===== Reporting Aggregations =====
  //
  // The Postgres counterparts of these, with the two dialect differences that
  // matter spelled out:
  //
  //  - `orders.created_at` is an INTEGER of epoch milliseconds here and a
  //    TIMESTAMP there, so the range predicate compares the parameter directly
  //    instead of going through `to_timestamp`.
  //  - Day bucketing needs `strftime(..., 'unixepoch')`, which yields a UTC
  //    date. That matches the Postgres side, where `to_char` renders a
  //    `TIMESTAMP` written by `CURRENT_TIMESTAMP` in the database server's
  //    timezone — UTC in every image this project ships. Both therefore bucket
  //    by UTC days, so a store several hours behind it will see an evening sale
  //    counted against the following day. Changing that is a store-timezone
  //    setting, not a dialect fix, and it has to change in both adapters at once
  //    or the two databases will disagree about which day a sale belongs to.
  //
  // `FILTER (WHERE ...)` is avoided in favour of `SUM(CASE ...)`, as elsewhere
  // in this adapter.
  //
  // **Every money aggregate is `ROUND(..., 2)`, and that is not cosmetic.**
  // Money is `DECIMAL(10, 2)` in Postgres, where a SUM is exact, but `REAL` here
  // — IEEE floating point. Summing $15.12 and $5.00 in REAL yields
  // 20.119999999999997, which reaches a report card as "$20.119999999999997"
  // and, worse, fails to reconcile against the same figures from Postgres. The
  // column type is the constraint; re-rounding each sum to the cent is what
  // restores the DECIMAL semantics the rest of the system assumes. Found by
  // executing these queries in CI, which is the entire reason this spec exists.
  //
  // `RegisterFilter` narrows every one of these, threaded through as an
  // additional, optional predicate. `locationIds` is always expressed as a
  // subquery against `registers` rather than an extra JOIN, so it applies
  // uniformly whether or not the query already joins that table.

  /**
   * Builds ` AND ...` fragments for a {@link RegisterFilter}, `?`-parameterised
   * to match this file's placeholder style.
   *
   * `registerCol`/`cashierCol` are the columns on the query's own rows —
   * `o.register_id`, `r.id`, `s.register_id`, whatever the caller already
   * joined to. An empty array in the filter is treated as "not filtering on
   * this field", same as `undefined`: a caller clearing a multi-select and
   * sending `?registerIds=` should see the unfiltered report, not zero rows.
   */
  private registerFilterSQL(
    filter: RegisterFilter | undefined,
    registerCol: string,
    cashierCol?: string
  ): { clause: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];

    if (filter?.registerIds?.length) {
      parts.push(`${registerCol} IN (${filter.registerIds.map(() => '?').join(',')})`);
      params.push(...filter.registerIds);
    }
    if (filter?.locationIds?.length) {
      parts.push(
        `${registerCol} IN (SELECT id FROM registers WHERE location_id IN (${filter.locationIds
          .map(() => '?')
          .join(',')}))`
      );
      params.push(...filter.locationIds);
    }
    if (cashierCol && filter?.cashierUserIds?.length) {
      parts.push(`${cashierCol} IN (${filter.cashierUserIds.map(() => '?').join(',')})`);
      params.push(...filter.cashierUserIds);
    }

    return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
  }

  async getSalesTotals(range: ReportRange, filter?: RegisterFilter): Promise<SalesTotals> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'register_id',
        'cashier_user_id'
      );
      const row = this.db
        .prepare(
          `SELECT
             COUNT(*) as order_count,
             ROUND(COALESCE(SUM(subtotal), 0), 2) as gross,
             ROUND(COALESCE(SUM(discount_total), 0), 2) as discounts,
             ROUND(COALESCE(SUM(tax_total), 0), 2) as tax,
             ROUND(COALESCE(SUM(total), 0), 2) as net
           FROM orders
           WHERE created_at >= ? AND created_at <= ?${clause}`
        )
        .get(range.from, range.to, ...filterParams) as DbRow;

      return {
        orderCount: Number(row.order_count ?? 0),
        gross: Number(row.gross ?? 0),
        discounts: Number(row.discounts ?? 0),
        tax: Number(row.tax ?? 0),
        net: Number(row.net ?? 0),
      };
    } catch (error) {
      logger.error('Error getting sales totals:', error);
      throw new DatabaseError('Failed to get sales totals');
    }
  }

  async getSalesByDay(range: ReportRange, filter?: RegisterFilter): Promise<SalesByDay[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'register_id',
        'cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as date,
             COUNT(*) as order_count,
             ROUND(COALESCE(SUM(subtotal), 0), 2) as gross,
             ROUND(COALESCE(SUM(total), 0), 2) as net
           FROM orders
           WHERE created_at >= ? AND created_at <= ?${clause}
           GROUP BY 1
           ORDER BY 1`
        )
        .all(range.from, range.to, ...filterParams) as DbRow[];

      return rows.map((row) => ({
        date: String(row.date),
        orderCount: Number(row.order_count ?? 0),
        gross: Number(row.gross ?? 0),
        net: Number(row.net ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting sales by day:', error);
      throw new DatabaseError('Failed to get sales by day');
    }
  }

  async getTopProducts(
    range: ReportRange,
    limit: number,
    filter?: RegisterFilter
  ): Promise<TopProduct[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             oi.product_id as product_id,
             MIN(oi.name_snapshot) as name,
             COALESCE(SUM(oi.quantity), 0) as quantity,
             ROUND(COALESCE(SUM(oi.line_total), 0), 2) as revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE o.created_at >= ? AND o.created_at <= ?${clause}
           GROUP BY oi.product_id
           ORDER BY revenue DESC, quantity DESC
           LIMIT ?`
        )
        .all(range.from, range.to, ...filterParams, limit) as DbRow[];

      return rows.map((row) => ({
        productId: String(row.product_id),
        name: String(row.name),
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting top products:', error);
      throw new DatabaseError('Failed to get top products');
    }
  }

  async getPaymentMix(range: ReportRange, filter?: RegisterFilter): Promise<PaymentMix[]> {
    try {
      // The range (and filter) parameters appear twice because the UNION
      // reads `orders` twice; `?` is positional, so the values are passed
      // twice to match. Filtered on `o.*` in both branches — `payments` rows
      // are attributed through the order they belong to, not their own
      // (also backfilled, but redundant) `register_id`.
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT method, COUNT(*) as count, ROUND(COALESCE(SUM(amount), 0), 2) as amount
           FROM (
             SELECT LOWER(p.method) as method, p.amount as amount
             FROM payments p
             JOIN orders o ON o.id = p.order_id
             WHERE o.created_at >= ? AND o.created_at <= ?${clause}
             UNION ALL
             SELECT LOWER(o.payment_method) as method, o.total as amount
             FROM orders o
             WHERE o.created_at >= ? AND o.created_at <= ?${clause}
               AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = o.id)
           )
           GROUP BY method
           ORDER BY amount DESC, method`
        )
        .all(
          range.from,
          range.to,
          ...filterParams,
          range.from,
          range.to,
          ...filterParams
        ) as DbRow[];

      return rows.map((row) => ({
        method: String(row.method),
        count: Number(row.count ?? 0),
        amount: Number(row.amount ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting payment mix:', error);
      throw new DatabaseError('Failed to get payment mix');
    }
  }

  async getReturnsTotals(range: ReportRange, filter?: RegisterFilter): Promise<ReturnsTotals> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'register_id',
        'cashier_user_id'
      );
      const row = this.db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as return_count,
             ROUND(COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0), 2) as refunded,
             SUM(CASE WHEN status IN ('pending', 'approved') THEN 1 ELSE 0 END) as pending_count,
             ROUND(COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN total ELSE 0 END), 0), 2) as pending_amount
           FROM returns
           WHERE created_at >= ? AND created_at <= ?${clause}`
        )
        .get(range.from, range.to, ...filterParams) as DbRow;

      return {
        returnCount: Number(row.return_count ?? 0),
        refunded: Number(row.refunded ?? 0),
        pendingCount: Number(row.pending_count ?? 0),
        pendingAmount: Number(row.pending_amount ?? 0),
      };
    } catch (error) {
      logger.error('Error getting returns totals:', error);
      throw new DatabaseError('Failed to get returns totals');
    }
  }

  async getReturnsByReason(
    range: ReportRange,
    filter?: RegisterFilter
  ): Promise<ReturnsByReason[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'register_id',
        'cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             COALESCE(NULLIF(reason_code, ''), 'unspecified') as reason_code,
             COUNT(*) as return_count,
             ROUND(COALESCE(SUM(total), 0), 2) as refunded
           FROM returns
           WHERE status = 'completed'
             AND created_at >= ? AND created_at <= ?${clause}
           GROUP BY 1
           ORDER BY refunded DESC, reason_code`
        )
        .all(range.from, range.to, ...filterParams) as DbRow[];

      return rows.map((row) => ({
        reasonCode: String(row.reason_code),
        returnCount: Number(row.return_count ?? 0),
        refunded: Number(row.refunded ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting returns by reason:', error);
      throw new DatabaseError('Failed to get returns by reason');
    }
  }

  /**
   * How many sales went through each till — the question this whole phase
   * exists to answer.
   *
   * `JOIN orders o ON o.register_id = r.id AND o.created_at BETWEEN ? AND ?`
   * puts the range predicate in the join condition rather than the WHERE
   * clause. With an INNER JOIN the two are equivalent, but writing it this way
   * makes it obvious this is *not* a LEFT JOIN: a register that sold nothing
   * in range does not appear, and nothing here filters on `r.status`, so a
   * retired or disabled register that DID trade in range appears exactly like
   * an active one.
   */
  async getSalesByRegister(
    range: ReportRange,
    filter?: RegisterFilter
  ): Promise<SalesByRegister[]> {
    try {
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id'
      );
      const { clause: orderClause, params: orderParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             r.id as register_id,
             r.display_code as display_code,
             r.name as name,
             r.location_id as location_id,
             l.name as location_name,
             r.type as type,
             r.has_cash_drawer as has_cash_drawer,
             r.status as status,
             COUNT(o.id) as order_count,
             ROUND(COALESCE(SUM(o.subtotal), 0), 2) as gross,
             ROUND(COALESCE(SUM(o.discount_total), 0), 2) as discounts,
             ROUND(COALESCE(SUM(o.tax_total), 0), 2) as tax,
             ROUND(COALESCE(SUM(o.total), 0), 2) as net
           FROM registers r
           JOIN locations l ON l.id = r.location_id
           JOIN orders o ON o.register_id = r.id
             AND o.created_at >= ? AND o.created_at <= ?${orderClause}
           WHERE 1=1${registerClause}
           GROUP BY r.id, r.display_code, r.name, r.location_id, l.name, r.type, r.has_cash_drawer, r.status
           ORDER BY l.name ASC, r.register_number ASC`
        )
        .all(range.from, range.to, ...orderParams, ...registerParams) as DbRow[];

      return rows.map((row) => ({
        registerId: String(row.register_id),
        displayCode: String(row.display_code),
        name: String(row.name),
        locationId: String(row.location_id),
        locationName: String(row.location_name),
        type: String(row.type),
        hasCashDrawer: Boolean(row.has_cash_drawer),
        status: String(row.status),
        orderCount: Number(row.order_count ?? 0),
        gross: Number(row.gross ?? 0),
        discounts: Number(row.discounts ?? 0),
        tax: Number(row.tax ?? 0),
        net: Number(row.net ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting sales by register:', error);
      throw new DatabaseError('Failed to get sales by register');
    }
  }

  /**
   * Sales attributed to whoever rang them, not whoever is signed in now.
   *
   * Groups on `orders.cashier_user_id` as it was written at checkout —
   * `services/registerShifts.ts` sets it once, from the shift open at the
   * moment the sale completed, and it is never rewritten by a later shift on
   * the same register. Orders from before migration 016 carry no cashier at
   * all; those fall into the `'unknown'` bucket below rather than vanishing,
   * so this report's total still reconciles with the unfiltered range.
   */
  async getSalesByCashier(range: ReportRange, filter?: RegisterFilter): Promise<SalesByCashier[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             COALESCE(o.cashier_user_id, 'unknown') as cashier_user_id,
             COALESCE(u.name, 'Unknown') as cashier_name,
             COUNT(*) as order_count,
             ROUND(COALESCE(SUM(o.subtotal), 0), 2) as gross,
             ROUND(COALESCE(SUM(o.total), 0), 2) as net
           FROM orders o
           LEFT JOIN users u ON u.id = o.cashier_user_id
           WHERE o.created_at >= ? AND o.created_at <= ?${clause}
           GROUP BY COALESCE(o.cashier_user_id, 'unknown'), COALESCE(u.name, 'Unknown')
           ORDER BY net DESC`
        )
        .all(range.from, range.to, ...filterParams) as DbRow[];

      return rows.map((row) => ({
        cashierUserId: String(row.cashier_user_id),
        cashierName: String(row.cashier_name),
        orderCount: Number(row.order_count ?? 0),
        gross: Number(row.gross ?? 0),
        net: Number(row.net ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting sales by cashier:', error);
      throw new DatabaseError('Failed to get sales by cashier');
    }
  }

  /**
   * Sales rolled up to the site. `registerCount` is `COUNT(DISTINCT
   * o.register_id)` — how many tills actually rang something in range, not
   * how many the location owns — matching `getSalesByRegister`'s "only
   * registers that traded" framing.
   *
   * No separate location-scoped clause: `registerCol: 'r.id'` below already
   * covers `locationIds` (translated to `r.id IN (SELECT id FROM registers
   * WHERE location_id IN (...))`), since `registerFilterSQL`'s `locationIds`
   * branch is always expressed as a subquery against `registers` regardless
   * of which register-identifying column it is applied to. Applying it again
   * against `l.id` directly would compare a location id to a set of register
   * ids — never equal, so it would silently zero out every result whenever
   * `registerIds` was the only filter in play. Found by the integration test
   * below.
   */
  async getSalesByLocation(range: ReportRange, filter?: RegisterFilter): Promise<SalesByLocation[]> {
    try {
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id'
      );
      const { clause: orderClause, params: orderParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             l.id as location_id,
             l.name as location_name,
             COUNT(DISTINCT o.register_id) as register_count,
             COUNT(o.id) as order_count,
             ROUND(COALESCE(SUM(o.total), 0), 2) as net
           FROM locations l
           JOIN registers r ON r.location_id = l.id
           JOIN orders o ON o.register_id = r.id
             AND o.created_at >= ? AND o.created_at <= ?${orderClause}
           WHERE 1=1${registerClause}
           GROUP BY l.id, l.name
           ORDER BY l.name ASC`
        )
        .all(range.from, range.to, ...orderParams, ...registerParams) as DbRow[];

      return rows.map((row) => ({
        locationId: String(row.location_id),
        locationName: String(row.location_name),
        registerCount: Number(row.register_count ?? 0),
        orderCount: Number(row.order_count ?? 0),
        net: Number(row.net ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting sales by location:', error);
      throw new DatabaseError('Failed to get sales by location');
    }
  }

  /**
   * Drawer reconciliation by register — the report that catches theft and
   * counting mistakes.
   *
   * Scoped to `status = 'closed'` sessions whose `closed_at` falls in range:
   * an open session's `variance` is NULL, and a session is only reportable
   * once it has one. `cashierUserIds` is deliberately not applied here —
   * `cash_drawer_sessions` carries `opened_by`/`closed_by`, not a
   * `cashier_user_id` in the shift-attribution sense `orders` uses, and
   * guessing which of the two "is" the cashier would silently hide sessions
   * rather than report on them.
   */
  async getDrawerVarianceByRegister(
    range: ReportRange,
    filter?: RegisterFilter
  ): Promise<DrawerVarianceByRegister[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(filter, 'r.id');
      const rows = this.db
        .prepare(
          `SELECT
             r.id as register_id,
             r.display_code as display_code,
             r.name as name,
             COUNT(s.id) as session_count,
             ROUND(COALESCE(SUM(s.variance), 0), 2) as total_variance,
             ROUND(COALESCE(MIN(s.variance), 0), 2) as worst_variance,
             SUM(CASE WHEN s.variance < 0 THEN 1 ELSE 0 END) as short_count
           FROM registers r
           JOIN cash_drawer_sessions s ON s.register_id = r.id
             AND s.status = 'closed' AND s.closed_at >= ? AND s.closed_at <= ?
           WHERE 1=1${clause}
           GROUP BY r.id, r.display_code, r.name
           ORDER BY total_variance ASC`
        )
        .all(range.from, range.to, ...filterParams) as DbRow[];

      return rows.map((row) => ({
        registerId: String(row.register_id),
        displayCode: String(row.display_code),
        name: String(row.name),
        sessionCount: Number(row.session_count ?? 0),
        totalVariance: Number(row.total_variance ?? 0),
        worstVariance: Number(row.worst_variance ?? 0),
        shortCount: Number(row.short_count ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting drawer variance by register:', error);
      throw new DatabaseError('Failed to get drawer variance by register');
    }
  }

  /**
   * `register_overrides` rows with `action = 'no_sale'` — a drawer opened
   * with nothing rung up, and the single best theft signal a POS can report
   * on. `cashierUserIds` is matched against `requested_by_user_id`: that is
   * the person who was standing at the till asking for the drawer to open,
   * where `approver_user_id` is the supervisor who authorised it.
   */
  async getNoSaleCounts(range: ReportRange, filter?: RegisterFilter): Promise<NoSaleCount[]> {
    try {
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id'
      );
      const { clause: overrideClause, params: overrideParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.requested_by_user_id'
      );
      const rows = this.db
        .prepare(
          `SELECT
             r.id as register_id,
             r.display_code as display_code,
             r.name as name,
             COUNT(o.id) as no_sale_count
           FROM registers r
           JOIN register_overrides o ON o.register_id = r.id
             AND o.action = 'no_sale' AND o.created_at >= ? AND o.created_at <= ?${overrideClause}
           WHERE 1=1${registerClause}
           GROUP BY r.id, r.display_code, r.name
           ORDER BY no_sale_count DESC`
        )
        .all(range.from, range.to, ...overrideParams, ...registerParams) as DbRow[];

      return rows.map((row) => ({
        registerId: String(row.register_id),
        displayCode: String(row.display_code),
        name: String(row.name),
        noSaleCount: Number(row.no_sale_count ?? 0),
      }));
    } catch (error) {
      logger.error('Error getting no-sale counts:', error);
      throw new DatabaseError('Failed to get no-sale counts');
    }
  }

  /**
   * One register's trading by hour of its **location's local day** — see
   * `timezoneBucketing.ts` for why the bucketing itself happens in
   * TypeScript rather than SQL. This method's job is only to fetch the raw
   * `(createdAt, total)` rows and the register's location timezone; the
   * shared helper does the rest, identically on both adapters.
   */
  async getRegisterHourly(range: ReportRange, registerId: string): Promise<RegisterHourly[]> {
    try {
      const location = this.db
        .prepare(
          `SELECT l.timezone as timezone
           FROM registers r
           JOIN locations l ON l.id = r.location_id
           WHERE r.id = ?`
        )
        .get(registerId) as DbRow | undefined;

      const orders = this.db
        .prepare(
          `SELECT created_at as created_at, total as total
           FROM orders
           WHERE register_id = ? AND created_at >= ? AND created_at <= ?`
        )
        .all(registerId, range.from, range.to) as DbRow[];

      return bucketOrdersByLocalHour(
        orders.map((row) => ({ createdAt: Number(row.created_at), total: Number(row.total) })),
        location?.timezone ? String(location.timezone) : 'UTC'
      );
    } catch (error) {
      logger.error('Error getting register hourly report:', error);
      throw new DatabaseError('Failed to get register hourly report');
    }
  }

  // ===== Terminal Transaction Operations =====
  async createTerminalTransaction(data: TerminalTransactionCreate): Promise<{ id: string }> {
    try {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO terminal_transactions
             (id, created_at, amount, currency, provider, charge_id, status, reader_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          data.startedAt,
          data.amount,
          data.currency,
          data.provider,
          data.chargeId,
          data.status,
          data.readerId ?? null
        );
      return { id };
    } catch (error) {
      logger.error('Error creating terminal transaction:', error);
      throw new DatabaseError('Failed to create terminal transaction');
    }
  }

  async updateTerminalTransactionByChargeId(
    chargeId: string,
    updates: TerminalTransactionUpdate
  ): Promise<void> {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
      if (updates.authCode !== undefined) { fields.push('auth_code = ?'); values.push(updates.authCode); }
      if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }
      if (updates.orderId !== undefined) { fields.push('order_id = ?'); values.push(updates.orderId); }
      if (updates.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(updates.durationMs); }

      if (fields.length === 0) return;

      values.push(chargeId);
      this.db.prepare(`UPDATE terminal_transactions SET ${fields.join(', ')} WHERE charge_id = ?`).run(...values);
    } catch (error) {
      logger.error('Error updating terminal transaction:', error);
      throw new DatabaseError('Failed to update terminal transaction');
    }
  }

  // ===== Cash drawer sessions =====

  /** Scoped to one register: three tills can each have a session open at once. */
  async getOpenDrawerSession(registerId: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT s.*, o.name AS opened_by_name,
                  r.name AS register_name, r.display_code AS register_display_code
           FROM cash_drawer_sessions s
           LEFT JOIN users o ON s.opened_by = o.id
           LEFT JOIN registers r ON s.register_id = r.id
           WHERE s.status = 'open' AND s.register_id = ? LIMIT 1`
        )
        .get(registerId) as DbRow | undefined;
      return row ? mapDrawerSessionRow(row) : null;
    } catch (error) {
      logger.error('Error getting open drawer session:', error);
      throw new DatabaseError('Failed to get drawer session');
    }
  }

  /**
   * See the Postgres adapter: the per-register partial unique index is what
   * enforces exclusivity. `registerId` is required at the type level (an
   * object parameter, not a positional string) so a caller cannot omit it
   * and land a NULL that the unique index would not constrain at all - NULLs
   * are distinct from one another in both SQLite's and Postgres's unique
   * indexes.
   */
  async openDrawerSession(input: {
    registerId: string;
    openingFloat: number;
    userId?: string;
  }): Promise<DbRow> {
    try {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO cash_drawer_sessions (id, register_id, opened_by, opened_at, opening_float, status)
           VALUES (?, ?, ?, ?, ?, 'open')`
        )
        .run(id, input.registerId, input.userId ?? null, Date.now(), input.openingFloat);

      return mapDrawerSessionRow(
        this.db.prepare('SELECT * FROM cash_drawer_sessions WHERE id = ?').get(id) as DbRow
      );
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) {
        throw new ValidationError(`Register ${input.registerId} already has a drawer session open`);
      }
      logger.error('Error opening drawer session:', error);
      throw new DatabaseError('Failed to open drawer session');
    }
  }

  /**
   * Float, plus cash taken in, less change given out, for this session.
   *
   * Joins on `orders.drawer_session_id` rather than a time window. A time
   * window (`o.created_at BETWEEN s.opened_at AND s.closed_at`) was correct
   * back when only one drawer could ever be open at a time, but migration 016
   * lets multiple registers each hold an open session concurrently - their
   * open windows overlap, so a time-window join would sum every register's
   * cash sales into every open session's expected cash, not just its own.
   * Direct attribution via `drawer_session_id` (backfilled by 016 for any
   * session that was open at migration time) is unambiguous regardless of
   * how many sessions are open simultaneously.
   */
  async getExpectedDrawerCash(sessionId: string): Promise<number> {
    try {
      const row = this.db
        .prepare(
          `SELECT
             s.opening_float
               + COALESCE(SUM(COALESCE(o.amount_tendered, o.total) - COALESCE(o.change_given, 0)), 0)
               AS expected
           FROM cash_drawer_sessions s
           LEFT JOIN orders o
             ON o.drawer_session_id = s.id
            AND LOWER(o.payment_method) = 'cash'
           WHERE s.id = ?
           GROUP BY s.opening_float`
        )
        .get(sessionId) as DbRow | undefined;
      return row ? Number(row.expected) : 0;
    } catch (error) {
      logger.error('Error computing expected drawer cash:', error);
      throw new DatabaseError('Failed to compute expected cash');
    }
  }

  async closeDrawerSession(
    sessionId: string,
    countedCash: number,
    expectedCash: number,
    userId?: string,
    notes?: string
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE cash_drawer_sessions
           SET status = 'closed', closed_at = ?, closed_by = ?,
               counted_cash = ?, expected_cash = ?, variance = ? - ?, notes = ?
           WHERE id = ? AND status = 'open'`
        )
        .run(Date.now(), userId ?? null, countedCash, expectedCash, countedCash, expectedCash, notes ?? null, sessionId);

      if (result.changes === 0) return null;
      return mapDrawerSessionRow(
        this.db.prepare('SELECT * FROM cash_drawer_sessions WHERE id = ?').get(sessionId) as DbRow
      );
    } catch (error) {
      logger.error('Error closing drawer session:', error);
      throw new DatabaseError('Failed to close drawer session');
    }
  }

  /** Unfiltered when `registerId` is omitted - the admin reconciliation view. */
  async getDrawerSessions(limit = 50, registerId?: string): Promise<DbRow[]> {
    try {
      let query = `
        SELECT s.*, o.name AS opened_by_name, c.name AS closed_by_name,
               r.name AS register_name, r.display_code AS register_display_code
        FROM cash_drawer_sessions s
        LEFT JOIN users o ON s.opened_by = o.id
        LEFT JOIN users c ON s.closed_by = c.id
        LEFT JOIN registers r ON s.register_id = r.id
      `;
      const params: unknown[] = [];
      if (registerId) {
        query += ' WHERE s.register_id = ?';
        params.push(registerId);
      }
      query += ' ORDER BY s.opened_at DESC LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(query).all(...params) as DbRow[];
      return rows.map(mapDrawerSessionRow);
    } catch (error) {
      logger.error('Error listing drawer sessions:', error);
      throw new DatabaseError('Failed to list drawer sessions');
    }
  }


  // ===== Product variants =====

  /** See the Postgres adapter for why these exist. */
  async createVariant(productId: string, variant: Record<string, unknown>): Promise<DbRow | null> {
    try {
      const product = this.db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
      if (!product) return null;

      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO product_variants
           (id, product_id, size, color, price_override, price_delta, sku, barcode, stock, enabled,
            low_stock_threshold)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id, productId, variant.size ?? null, variant.color ?? null,
          variant.priceOverride ?? null, variant.priceDelta ?? null,
          variant.sku ?? null, variant.barcode ?? null,
          variant.stock ?? 0, variant.enabled !== false ? 1 : 0,
          variant.lowStockThreshold ?? null
        );

      return mapVariantRow(
        this.db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id) as DbRow
      );
    } catch (error) {
      logger.error('Error creating variant:', error);
      throw new DatabaseError('Failed to create variant');
    }
  }

  async updateVariant(
    productId: string,
    variantId: string,
    variant: Record<string, unknown>
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE product_variants
           SET size = COALESCE(?, size),
               color = COALESCE(?, color),
               price_override = COALESCE(?, price_override),
               price_delta = COALESCE(?, price_delta),
               sku = COALESCE(?, sku),
               barcode = COALESCE(?, barcode),
               stock = COALESCE(?, stock),
               enabled = COALESCE(?, enabled),
               -- See the Postgres adapter: explicit null clears the override.
               low_stock_threshold = CASE
                 WHEN ? = 1 THEN NULL
                 ELSE COALESCE(?, low_stock_threshold)
               END
           WHERE id = ? AND product_id = ?`
        )
        .run(
          variant.size ?? null, variant.color ?? null,
          variant.priceOverride ?? null, variant.priceDelta ?? null,
          variant.sku ?? null, variant.barcode ?? null,
          variant.stock ?? null,
          variant.enabled === undefined ? null : variant.enabled ? 1 : 0,
          'lowStockThreshold' in variant && variant.lowStockThreshold === null ? 1 : 0,
          variant.lowStockThreshold ?? null,
          variantId, productId
        );

      if (result.changes === 0) return null;
      return mapVariantRow(
        this.db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId) as DbRow
      );
    } catch (error) {
      logger.error('Error updating variant:', error);
      throw new DatabaseError('Failed to update variant');
    }
  }

  // ===== Categories =====
  // See the Postgres adapter for why `products.category` holds the name rather
  // than a foreign key, and what that costs on rename and delete.

  async getAllCategories(): Promise<DbRow[]> {
    try {
      return this.db
        .prepare(
          `SELECT c.id, c.name, c.icon, COUNT(p.id) AS productCount
           FROM categories c
           LEFT JOIN products p ON p.category = c.name
           GROUP BY c.id, c.name, c.icon
           ORDER BY c.name ASC`
        )
        .all() as DbRow[];
    } catch (error) {
      logger.error('Error getting categories:', error);
      throw new DatabaseError('Failed to get categories');
    }
  }

  /** See the Postgres adapter: names products use that no category row defines. */
  async getUnmanagedCategories(): Promise<DbRow[]> {
    try {
      return this.db
        .prepare(
          `SELECT p.category AS name, COUNT(*) AS productCount
           FROM products p
           LEFT JOIN categories c ON c.name = p.category
           WHERE c.id IS NULL AND p.category IS NOT NULL AND p.category <> ''
           GROUP BY p.category
           ORDER BY p.category ASC`
        )
        .all() as DbRow[];
    } catch (error) {
      logger.error('Error getting unmanaged categories:', error);
      throw new DatabaseError('Failed to get categories');
    }
  }

  async createCategory(name: string, icon: string | null): Promise<DbRow | null> {
    try {
      const clash = this.db
        .prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)')
        .get(name);
      if (clash) return null;

      const id = crypto.randomUUID();
      this.db.prepare('INSERT INTO categories (id, name, icon) VALUES (?, ?, ?)').run(id, name, icon);
      return { id, name, icon, productCount: 0 };
    } catch (error) {
      logger.error('Error creating category:', error);
      throw new DatabaseError('Failed to create category');
    }
  }

  async renameCategory(
    id: string,
    name: string,
    icon: string | null | undefined
  ): Promise<DbRow | null | 'duplicate'> {
    try {
      const run = this.db.transaction(() => {
        const existing = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as
          | { name: string }
          | undefined;
        if (!existing) return null;

        const clash = this.db
          .prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id <> ?')
          .get(name, id);
        if (clash) return 'duplicate' as const;

        this.db
          .prepare('UPDATE categories SET name = ?, icon = COALESCE(?, icon) WHERE id = ?')
          .run(name, icon ?? null, id);
        const moved = this.db
          .prepare('UPDATE products SET category = ? WHERE category = ?')
          .run(name, existing.name);

        return { id, name, icon: icon ?? null, productCount: moved.changes } as DbRow;
      });
      return run();
    } catch (error) {
      logger.error('Error renaming category:', error);
      throw new DatabaseError('Failed to rename category');
    }
  }

  async deleteCategory(
    id: string,
    reassignTo?: string
  ): Promise<'deleted' | 'not_found' | { inUse: number } | 'bad_target'> {
    try {
      const run = this.db.transaction(() => {
        const existing = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as
          | { name: string }
          | undefined;
        if (!existing) return 'not_found' as const;

        const { count } = this.db
          .prepare('SELECT COUNT(*) AS count FROM products WHERE category = ?')
          .get(existing.name) as { count: number };

        if (count > 0) {
          if (!reassignTo) return { inUse: count };

          const target = this.db
            .prepare('SELECT name FROM categories WHERE LOWER(name) = LOWER(?) AND id <> ?')
            .get(reassignTo, id) as { name: string } | undefined;
          if (!target) return 'bad_target' as const;

          this.db
            .prepare('UPDATE products SET category = ? WHERE category = ?')
            .run(target.name, existing.name);
        }

        this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
        return 'deleted' as const;
      });
      return run();
    } catch (error) {
      logger.error('Error deleting category:', error);
      throw new DatabaseError('Failed to delete category');
    }
  }

  /** See the Postgres adapter for the reasoning behind the fallback and ordering. */
  async getLowStockVariants(defaultThreshold: number): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT v.*, p.id AS product_id, p.name AS product_name, p.category
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           WHERE v.enabled = 1
             AND v.stock <= COALESCE(v.low_stock_threshold, ?)
           ORDER BY v.stock - COALESCE(v.low_stock_threshold, ?) ASC, p.name ASC`
        )
        .all(defaultThreshold, defaultThreshold) as DbRow[];

      return rows.map((row) => ({
        ...mapVariantRow(row),
        productId: row.product_id,
        productName: row.product_name,
        category: row.category,
        threshold: row.low_stock_threshold ?? defaultThreshold,
      }));
    } catch (error) {
      logger.error('Error loading low stock variants:', error);
      throw new DatabaseError('Failed to load low stock');
    }
  }

  async deleteVariant(productId: string, variantId: string): Promise<'deleted' | 'not_found' | 'last'> {
    try {
      const { count } = this.db
        .prepare('SELECT COUNT(*) AS count FROM product_variants WHERE product_id = ?')
        .get(productId) as { count: number };

      if (count <= 1) {
        const exists = this.db
          .prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?')
          .get(variantId, productId);
        return exists ? 'last' : 'not_found';
      }

      const result = this.db
        .prepare('DELETE FROM product_variants WHERE id = ? AND product_id = ?')
        .run(variantId, productId);
      return result.changes > 0 ? 'deleted' : 'not_found';
    } catch (error) {
      logger.error('Error deleting variant:', error);
      throw new DatabaseError('Failed to delete variant');
    }
  }

  // Location Operations

  /** Active locations first, then alphabetical. Each row carries a count of its non-retired registers. */
  async getLocations(orgId: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT l.*,
                  (SELECT COUNT(*) FROM registers r
                   WHERE r.location_id = l.id AND r.status <> 'retired') AS register_count
           FROM locations l
           WHERE l.org_id = ?
           ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.name ASC`
        )
        .all(orgId) as DbRow[];

      return rows.map((row) => ({ ...mapLocation(row), registerCount: Number(row.register_count) }));
    } catch (error) {
      logger.error('Error getting locations:', error);
      throw new DatabaseError('Failed to get locations');
    }
  }

  async getLocationById(id: string): Promise<DbRow | null> {
    try {
      const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as DbRow | undefined;
      return row ? mapLocation(row) : null;
    } catch (error) {
      logger.error('Error getting location by id:', error);
      throw new DatabaseError('Failed to get location');
    }
  }

  async createLocation(payload: Record<string, unknown>): Promise<DbRow | 'duplicate_slug'> {
    try {
      const orgId = String(payload.org_id);
      const slug = String(payload.slug);

      const clash = this.db
        .prepare('SELECT id FROM locations WHERE org_id = ? AND slug = ?')
        .get(orgId, slug);
      if (clash) return 'duplicate_slug';

      const id = crypto.randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO locations (id, org_id, name, slug, address, city, state, zip, timezone, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          orgId,
          String(payload.name),
          slug,
          (payload.address as string | undefined) ?? null,
          (payload.city as string | undefined) ?? null,
          (payload.state as string | undefined) ?? null,
          (payload.zip as string | undefined) ?? null,
          (payload.timezone as string | undefined) ?? 'UTC',
          (payload.status as string | undefined) ?? 'active',
          now,
          now
        );

      const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as DbRow;
      return mapLocation(row);
    } catch (error) {
      logger.error('Error creating location:', error);
      throw new DatabaseError('Failed to create location');
    }
  }

  /**
   * Partial update, built as a dynamic SET clause rather than COALESCE.
   *
   * COALESCE(?, column) cannot tell "the caller sent null to clear this
   * field" apart from "the caller didn't send this field at all" — both
   * arrive at better-sqlite3 as a bound NULL. That collapses the two into
   * one behavior (keep the existing value), which makes it impossible to
   * ever clear a nullable column such as `address`. So presence is checked
   * with `hasOwnProperty` before a column is included in the update at all;
   * only then does `?? null` decide whether an explicit null clears it.
   *
   * `name`, `slug`, `timezone` and `status` are NOT NULL, so an explicit
   * null for one of those is refused (the assignment is skipped) rather
   * than attempted — this is not full input validation, just the adapter
   * declining to write something the schema forbids.
   */
  async updateLocation(
    id: string,
    payload: Record<string, unknown>
  ): Promise<DbRow | null | 'duplicate_slug'> {
    try {
      const existing = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as
        | DbRow
        | undefined;
      if (!existing) return null;

      const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);

      if (has('slug') && payload.slug != null) {
        const slug = payload.slug as string;
        if (slug !== existing.slug) {
          const clash = this.db
            .prepare('SELECT id FROM locations WHERE org_id = ? AND slug = ? AND id <> ?')
            .get(existing.org_id, slug, id);
          if (clash) return 'duplicate_slug';
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };

      // NOT NULL columns: skip rather than write an explicit null.
      if (has('name') && payload.name != null) assign('name', payload.name);
      if (has('slug') && payload.slug != null) assign('slug', payload.slug);
      if (has('timezone') && payload.timezone != null) assign('timezone', payload.timezone);
      if (has('status') && payload.status != null) assign('status', payload.status);

      // Nullable columns: an explicit null clears them.
      if (has('address')) assign('address', payload.address ?? null);
      if (has('city')) assign('city', payload.city ?? null);
      if (has('state')) assign('state', payload.state ?? null);
      if (has('zip')) assign('zip', payload.zip ?? null);

      if (sets.length === 0) {
        return mapLocation(existing);
      }

      assign('updated_at', Date.now());
      values.push(id);

      this.db.prepare(`UPDATE locations SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as DbRow;
      return mapLocation(row);
    } catch (error) {
      logger.error('Error updating location:', error);
      throw new DatabaseError('Failed to update location');
    }
  }

  // Register Operations

  async getRegisters(filter: {
    orgId: string;
    locationId?: string;
    status?: string;
  }): Promise<DbRow[]> {
    try {
      let query = `
        SELECT r.*, l.name AS location_name
        FROM registers r
        JOIN locations l ON l.id = r.location_id
        WHERE r.org_id = ?
      `;
      const params: unknown[] = [filter.orgId];

      if (filter.locationId) {
        query += ' AND r.location_id = ?';
        params.push(filter.locationId);
      }
      if (filter.status) {
        query += ' AND r.status = ?';
        params.push(filter.status);
      }

      query += ' ORDER BY l.name ASC, r.register_number ASC';

      const rows = this.db.prepare(query).all(...params) as DbRow[];
      return rows.map((row) => ({ ...mapRegister(row), locationName: row.location_name }));
    } catch (error) {
      logger.error('Error getting registers:', error);
      throw new DatabaseError('Failed to get registers');
    }
  }

  async getRegisterById(id: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT r.*, l.name AS location_name
           FROM registers r
           JOIN locations l ON l.id = r.location_id
           WHERE r.id = ?`
        )
        .get(id) as DbRow | undefined;
      if (!row) return null;
      return { ...mapRegister(row), locationName: row.location_name };
    } catch (error) {
      logger.error('Error getting register by id:', error);
      throw new DatabaseError('Failed to get register');
    }
  }

  /**
   * `bad_location` covers both "no such location" and "location belongs to
   * a different org": the composite FK on `registers(location_id, org_id)`
   * would reject the latter anyway, but checking first lets the caller
   * produce a useful message instead of a raw constraint violation.
   */
  async createRegister(
    payload: Record<string, unknown>
  ): Promise<DbRow | 'duplicate_number' | 'duplicate_code' | 'bad_location'> {
    try {
      const orgId = String(payload.org_id);
      const locationId = String(payload.location_id);
      const registerNumber = Number(payload.register_number);
      const displayCode = String(payload.display_code);

      const location = this.db
        .prepare('SELECT org_id FROM locations WHERE id = ?')
        .get(locationId) as { org_id: string } | undefined;
      if (!location || String(location.org_id) !== orgId) return 'bad_location';

      const numberClash = this.db
        .prepare('SELECT id FROM registers WHERE location_id = ? AND register_number = ?')
        .get(locationId, registerNumber);
      if (numberClash) return 'duplicate_number';

      const codeClash = this.db
        .prepare('SELECT id FROM registers WHERE org_id = ? AND display_code = ?')
        .get(orgId, displayCode);
      if (codeClash) return 'duplicate_code';

      const id = crypto.randomUUID();
      const now = Date.now();
      // Flags are bound as 0/1: better-sqlite3 has no boolean bind type, so a
      // raw JS boolean here would throw at the native layer.
      this.db
        .prepare(
          `INSERT INTO registers
            (id, org_id, location_id, name, register_number, display_code, placement, type,
             has_cash_drawer, accepts_cash, can_refund, can_open_drawer_no_sale, require_sign_in,
             idle_lock_seconds, terminal_provider, terminal_device_id, status, created_by,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          orgId,
          locationId,
          String(payload.name),
          registerNumber,
          displayCode,
          (payload.placement as string | undefined) ?? null,
          (payload.type as string | undefined) ?? 'fixed',
          payload.has_cash_drawer !== false ? 1 : 0,
          payload.accepts_cash !== false ? 1 : 0,
          payload.can_refund !== false ? 1 : 0,
          payload.can_open_drawer_no_sale ? 1 : 0,
          payload.require_sign_in ? 1 : 0,
          (payload.idle_lock_seconds as number | undefined) ?? 300,
          (payload.terminal_provider as string | undefined) ?? null,
          (payload.terminal_device_id as string | undefined) ?? null,
          (payload.status as string | undefined) ?? 'pending',
          (payload.created_by as string | undefined) ?? null,
          now,
          now
        );

      const row = this.db.prepare('SELECT * FROM registers WHERE id = ?').get(id) as DbRow;
      return mapRegister(row);
    } catch (error) {
      logger.error('Error creating register:', error);
      throw new DatabaseError('Failed to create register');
    }
  }

  /**
   * Partial update, built as a dynamic SET clause rather than COALESCE —
   * see the comment on `updateLocation` for why. `terminal_provider` and
   * `terminal_device_id` are the case this exists for: unbinding a dead
   * card reader means sending `terminal_provider: null` and having it
   * actually clear, which COALESCE can never do.
   *
   * `org_id`, `location_id` and `register_number` are never read from the
   * payload here — changing any of them would move the register out from
   * under the composite FK and the per-location numbering the schema
   * enforces, so they are silently ignored rather than rejected.
   *
   * `name`, `display_code`, `type`, `status`, `idle_lock_seconds` and the
   * five capability flags are NOT NULL, so an explicit null for one of
   * those is refused (the assignment is skipped) rather than attempted.
   */
  async updateRegister(
    id: string,
    payload: Record<string, unknown>
  ): Promise<DbRow | null | 'duplicate_code'> {
    try {
      const existing = this.db.prepare('SELECT * FROM registers WHERE id = ?').get(id) as
        | DbRow
        | undefined;
      if (!existing) return null;

      const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);

      if (has('display_code') && payload.display_code != null) {
        const displayCode = payload.display_code as string;
        if (displayCode !== existing.display_code) {
          const clash = this.db
            .prepare('SELECT id FROM registers WHERE org_id = ? AND display_code = ? AND id <> ?')
            .get(existing.org_id, displayCode, id);
          if (clash) return 'duplicate_code';
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };

      // NOT NULL columns: skip rather than write an explicit null. Flags
      // are bound as 0/1: better-sqlite3 has no boolean bind type.
      if (has('name') && payload.name != null) assign('name', payload.name);
      if (has('display_code') && payload.display_code != null) {
        assign('display_code', payload.display_code);
      }
      if (has('type') && payload.type != null) assign('type', payload.type);
      if (has('status') && payload.status != null) assign('status', payload.status);
      if (has('idle_lock_seconds') && payload.idle_lock_seconds != null) {
        assign('idle_lock_seconds', payload.idle_lock_seconds);
      }
      if (has('has_cash_drawer') && payload.has_cash_drawer != null) {
        assign('has_cash_drawer', payload.has_cash_drawer ? 1 : 0);
      }
      if (has('accepts_cash') && payload.accepts_cash != null) {
        assign('accepts_cash', payload.accepts_cash ? 1 : 0);
      }
      if (has('can_refund') && payload.can_refund != null) {
        assign('can_refund', payload.can_refund ? 1 : 0);
      }
      if (has('can_open_drawer_no_sale') && payload.can_open_drawer_no_sale != null) {
        assign('can_open_drawer_no_sale', payload.can_open_drawer_no_sale ? 1 : 0);
      }
      if (has('require_sign_in') && payload.require_sign_in != null) {
        assign('require_sign_in', payload.require_sign_in ? 1 : 0);
      }

      // Nullable columns: an explicit null clears them.
      if (has('placement')) assign('placement', payload.placement ?? null);
      if (has('terminal_provider')) assign('terminal_provider', payload.terminal_provider ?? null);
      if (has('terminal_device_id')) {
        assign('terminal_device_id', payload.terminal_device_id ?? null);
      }

      if (sets.length === 0) {
        return mapRegister(existing);
      }

      assign('updated_at', Date.now());
      values.push(id);

      this.db.prepare(`UPDATE registers SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      const row = this.db.prepare('SELECT * FROM registers WHERE id = ?').get(id) as DbRow;
      return mapRegister(row);
    } catch (error) {
      logger.error('Error updating register:', error);
      throw new DatabaseError('Failed to update register');
    }
  }

  async setRegisterStatus(id: string, status: string): Promise<DbRow | null> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare('UPDATE registers SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM registers WHERE id = ?').get(id) as DbRow;
      return mapRegister(row);
    } catch (error) {
      logger.error('Error setting register status:', error);
      throw new DatabaseError('Failed to set register status');
    }
  }

  /**
   * Registers that occupy a licence slot: `pending`, `active` and
   * `disabled`. `retired` is excluded on purpose — a retired register frees
   * its slot, while a disabled one does not, because the device is expected
   * back.
   */
  async countRegistersForCap(orgId: string): Promise<number> {
    try {
      const { count } = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM registers
           WHERE org_id = ? AND status IN ('pending', 'active', 'disabled')`
        )
        .get(orgId) as { count: number };
      return Number(count);
    } catch (error) {
      logger.error('Error counting registers for cap:', error);
      throw new DatabaseError('Failed to count registers');
    }
  }

  /**
   * Every register number ever assigned at a location, including retired
   * ones: a retired register's number is never released for reuse, so the
   * next-number picker has to see it too.
   */
  async getUsedRegisterNumbers(locationId: string): Promise<number[]> {
    try {
      const rows = this.db
        .prepare('SELECT register_number FROM registers WHERE location_id = ? ORDER BY register_number ASC')
        .all(locationId) as { register_number: number }[];
      return rows.map((row) => Number(row.register_number));
    } catch (error) {
      logger.error('Error getting used register numbers:', error);
      throw new DatabaseError('Failed to get used register numbers');
    }
  }

  /**
   * The org-level register policy: how many registers it may enrol, and how
   * long a cashier's PIN must be. Lives on `organizations` — see migration
   * 015 — so this is a narrow projection of that row rather than a new table.
   */
  async getOrgPolicy(orgId: string): Promise<{ maxRegisters: number | null; pinLength: number } | null> {
    try {
      const row = this.db
        .prepare('SELECT max_registers, pin_length FROM organizations WHERE id = ?')
        .get(orgId) as { max_registers: number | null; pin_length: number } | undefined;
      if (!row) return null;

      return {
        maxRegisters: row.max_registers == null ? null : Number(row.max_registers),
        pinLength: Number(row.pin_length),
      };
    } catch (error) {
      logger.error('Error getting org policy:', error);
      throw new DatabaseError('Failed to get organization policy');
    }
  }

  /**
   * Above this, a drawer closing short (or over) needs a manager override —
   * migration 019. NULL disables the check entirely, which is also the
   * default: most orgs will never turn this on.
   *
   * A separate narrow getter rather than folding into `getOrgPolicy`: that
   * method's return type is a public contract several callers already
   * destructure by shape (`{ maxRegisters, pinLength }`), and widening it
   * would ripple through every one of them for a value only drawer-close
   * cares about.
   */
  async getOrganizationDrawerVarianceThreshold(orgId: string): Promise<number | null> {
    try {
      const row = this.db
        .prepare('SELECT drawer_variance_threshold FROM organizations WHERE id = ?')
        .get(orgId) as { drawer_variance_threshold: number | null } | undefined;
      if (!row) return null;
      return row.drawer_variance_threshold == null ? null : Number(row.drawer_variance_threshold);
    } catch (error) {
      logger.error('Error getting organization drawer variance threshold:', error);
      throw new DatabaseError('Failed to get organization policy');
    }
  }

  // Register credentials (device enrolment — migration 017)

  /**
   * The register's outstanding, not-yet-redeemed pairing code, if it has
   * one — `token_hash IS NULL` is what distinguishes it from an enrolled
   * credential; see `idx_register_credentials_one_pairing_per_register`
   * (migration 017), which this query mirrors.
   */
  async getLiveUnredeemedPairingCredential(registerId: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM register_credentials
           WHERE register_id = ? AND revoked_at IS NULL AND token_hash IS NULL
           LIMIT 1`
        )
        .get(registerId) as DbRow | undefined;
      return row ? mapRegisterCredential(row) : null;
    } catch (error) {
      logger.error('Error getting live unredeemed pairing credential:', error);
      throw new DatabaseError('Failed to get register credential');
    }
  }

  /**
   * The register's currently enrolled device credential, if it has one —
   * `token_hash IS NOT NULL` mirrors `idx_register_credentials_one_enrolled_per_register`.
   */
  async getLiveEnrolledCredential(registerId: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM register_credentials
           WHERE register_id = ? AND revoked_at IS NULL AND token_hash IS NOT NULL
           LIMIT 1`
        )
        .get(registerId) as DbRow | undefined;
      return row ? mapRegisterCredential(row) : null;
    } catch (error) {
      logger.error('Error getting live enrolled credential:', error);
      throw new DatabaseError('Failed to get register credential');
    }
  }

  /**
   * Every live row for a register — up to two: an enrolled credential and
   * an outstanding pairing code can coexist (migration 017's two
   * independent partial unique indexes). Used by an explicit revoke, which
   * has to destroy everything live, not just one kind.
   */
  async getLiveRegisterCredentials(registerId: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM register_credentials WHERE register_id = ? AND revoked_at IS NULL')
        .all(registerId) as DbRow[];
      return rows.map(mapRegisterCredential);
    } catch (error) {
      logger.error('Error getting live register credentials:', error);
      throw new DatabaseError('Failed to get register credentials');
    }
  }

  async createPairingCredential(payload: {
    registerId: string;
    pairingCodePrefix: string;
    pairingCodeHash: string;
    pairingExpiresAt: number;
    createdBy: string | null;
  }): Promise<DbRow> {
    try {
      const id = crypto.randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO register_credentials
            (id, register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          payload.registerId,
          payload.pairingCodePrefix,
          payload.pairingCodeHash,
          payload.pairingExpiresAt,
          payload.createdBy,
          now
        );

      const row = this.db.prepare('SELECT * FROM register_credentials WHERE id = ?').get(id) as DbRow;
      return mapRegisterCredential(row);
    } catch (error) {
      logger.error('Error creating pairing credential:', error);
      throw new DatabaseError('Failed to create pairing credential');
    }
  }

  /**
   * Every row sharing a 4-character pairing-code prefix, regardless of
   * revoked/redeemed/expired state — the service layer does the bcrypt
   * comparison and the state checks, so this is a bare lookup by prefix.
   */
  async getPairingCredentialsByPrefix(prefix: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM register_credentials WHERE pairing_code_prefix = ?')
        .all(prefix) as DbRow[];
      return rows.map(mapRegisterCredential);
    } catch (error) {
      logger.error('Error getting pairing credentials by prefix:', error);
      throw new DatabaseError('Failed to get pairing credentials');
    }
  }

  /**
   * Guarded on `enrolled_at IS NULL AND revoked_at IS NULL` so a race between
   * two redemption attempts for the same code can only ever mint one token —
   * the loser gets zero rows changed and reads back as a plain miss.
   */
  async redeemPairingCredential(
    id: string,
    payload: { tokenPrefix: string; tokenHash: string; enrolledAt: number }
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE register_credentials
           SET token_prefix = ?, token_hash = ?, enrolled_at = ?
           WHERE id = ? AND enrolled_at IS NULL AND revoked_at IS NULL`
        )
        .run(payload.tokenPrefix, payload.tokenHash, payload.enrolledAt, id);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM register_credentials WHERE id = ?').get(id) as DbRow;
      return mapRegisterCredential(row);
    } catch (error) {
      logger.error('Error redeeming pairing credential:', error);
      throw new DatabaseError('Failed to redeem pairing credential');
    }
  }

  /** Every row sharing a device-token prefix, revoked or not — see the pairing-code equivalent above. */
  async getRegisterCredentialsByTokenPrefix(prefix: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM register_credentials WHERE token_prefix = ?')
        .all(prefix) as DbRow[];
      return rows.map(mapRegisterCredential);
    } catch (error) {
      logger.error('Error getting register credentials by token prefix:', error);
      throw new DatabaseError('Failed to get register credentials');
    }
  }

  /** Best-effort: a failure to stamp last-used must not fail the request it describes. */
  async touchRegisterCredentialLastUsed(id: string): Promise<void> {
    try {
      this.db.prepare('UPDATE register_credentials SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
    } catch (error) {
      logger.error('Error touching register credential last used:', error);
    }
  }

  /** Guarded on `revoked_at IS NULL` so revoking twice is a no-op, not a second audit-worthy event. */
  async revokeRegisterCredentialById(
    id: string,
    payload: { revokedBy: string | null; reason: string | null }
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE register_credentials
           SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(Date.now(), payload.revokedBy, payload.reason, id);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM register_credentials WHERE id = ?').get(id) as DbRow;
      return mapRegisterCredential(row);
    } catch (error) {
      logger.error('Error revoking register credential:', error);
      throw new DatabaseError('Failed to revoke register credential');
    }
  }

  /** Cheap by design — called on every device heartbeat, roughly once a minute per till. */
  async touchRegisterLastSeen(registerId: string): Promise<DbRow | null> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare('UPDATE registers SET last_seen_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, registerId);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM registers WHERE id = ?').get(registerId) as DbRow;
      return mapRegister(row);
    } catch (error) {
      logger.error('Error touching register last seen:', error);
      throw new DatabaseError('Failed to update register heartbeat');
    }
  }

  // PIN sign-in (register shifts — migration 018)

  /**
   * A single user by id, including the PIN columns — see `mapUserPin` for
   * why this is an internal-only shape. Used by `services/pins.ts` and
   * `services/registerShifts.ts`, never by a route directly.
   */
  async getUserById(id: string): Promise<DbRow | null> {
    try {
      const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbRow | undefined;
      return row ? mapUserPin(row) : null;
    } catch (error) {
      logger.error('Error getting user by id:', error);
      throw new DatabaseError('Failed to get user');
    }
  }

  /**
   * Every active user in an org who has a PIN set. Used two ways: `setPin`
   * scans it to enforce org-wide PIN uniqueness (comparing a candidate PIN
   * against every hash here — O(n), fine at a few hundred users), and
   * `registerShifts.startShift` scans it to work out which employee just
   * typed their PIN at a till that has no username field, only a keypad.
   *
   * `COALESCE(org_id, ...)` mirrors `authenticate`'s own fallback
   * (`DEFAULT_ORG_ID` in `auth.ts`): every user seeded before a second
   * organization existed has `org_id IS NULL`, so filtering on a bare
   * equality would make them invisible to PIN sign-in entirely.
   */
  async getActiveUsersWithPin(orgId: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM users
           WHERE status = 'active' AND pin_hash IS NOT NULL
             AND COALESCE(org_id, ?) = ?`
        )
        .all(DEFAULT_ORG_ID, orgId) as DbRow[];
      return rows.map(mapUserPin);
    } catch (error) {
      logger.error('Error getting active users with a PIN:', error);
      throw new DatabaseError('Failed to get users');
    }
  }

  /**
   * Every active, PIN-holding user in an org who may also approve a manager
   * override (`can_override` — migration 018). The narrower sibling of
   * {@link getActiveUsersWithPin}: `services/registerOverrides.ts` scans this
   * instead of the full PIN roster so that a cashier's PIN — real, but not an
   * approver's — is indistinguishable from a PIN that matches nobody at all.
   */
  async getActiveUsersWithOverridePermission(orgId: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM users
           WHERE status = 'active' AND pin_hash IS NOT NULL AND can_override = 1
             AND COALESCE(org_id, ?) = ?`
        )
        .all(DEFAULT_ORG_ID, orgId) as DbRow[];
      return rows.map(mapUserPin);
    } catch (error) {
      logger.error('Error getting active users with override permission:', error);
      throw new DatabaseError('Failed to get users');
    }
  }

  /**
   * Set (or replace) a user's PIN. Also clears any lockout: issuing a fresh
   * PIN is a deliberate reset, not something that should stay locked out on
   * the count run up against the old one.
   *
   * Returns a SAFE projection — no `pin_hash` — because unlike
   * `getUserById`/`getActiveUsersWithPin`, this return value is what a route
   * is expected to hand back in a response.
   */
  /**
   * Set or clear a user's PIN.
   *
   * A null `pinHash` clears it, which is how an admin revokes an employee's
   * ability to sign on to a till. Clearing also resets the lockout bookkeeping:
   * leaving a stale `pin_locked_until` behind would lock the *next* PIN issued
   * to that person before they had ever used it.
   */
  async setUserPin(
    userId: string,
    payload: { pinHash: string | null; pinSetAt: number | null }
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE users
           SET pin_hash = ?, pin_set_at = ?, pin_failed_count = 0, pin_locked_until = NULL
           WHERE id = ?`
        )
        .run(payload.pinHash, payload.pinSetAt, userId);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbRow;
      return {
        id: String(row.id),
        email: row.email,
        name: row.name,
        status: row.status,
        pinSetAt: row.pin_set_at == null ? null : Number(row.pin_set_at),
      };
    } catch (error) {
      logger.error('Error setting user PIN:', error);
      throw new DatabaseError('Failed to set PIN');
    }
  }

  /** Record a failed PIN attempt, and lock the account when the caller says the threshold was hit. */
  async recordPinFailure(
    userId: string,
    payload: { failedCount: number; lockedUntil: number | null }
  ): Promise<void> {
    try {
      this.db
        .prepare('UPDATE users SET pin_failed_count = ?, pin_locked_until = ? WHERE id = ?')
        .run(payload.failedCount, payload.lockedUntil, userId);
    } catch (error) {
      logger.error('Error recording PIN failure:', error);
      throw new DatabaseError('Failed to record PIN failure');
    }
  }

  /** A successful verify resets the counter and clears any lock. */
  async resetPinFailures(userId: string): Promise<void> {
    try {
      this.db
        .prepare('UPDATE users SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = ?')
        .run(userId);
    } catch (error) {
      logger.error('Error resetting PIN failures:', error);
      throw new DatabaseError('Failed to reset PIN failures');
    }
  }

  // Register shifts (migration 018)

  /** The register's currently open shift, if it has one — see migration 018's partial unique index. */
  async getOpenShiftForRegister(registerId: string): Promise<DbRow | null> {
    try {
      const row = this.db
        .prepare('SELECT * FROM register_shifts WHERE register_id = ? AND ended_at IS NULL LIMIT 1')
        .get(registerId) as DbRow | undefined;
      return row ? mapRegisterShift(row) : null;
    } catch (error) {
      logger.error('Error getting open register shift:', error);
      throw new DatabaseError('Failed to get open shift');
    }
  }

  /**
   * Open a shift. Callers are expected to have already ended any prior open
   * shift on this register (`services/registerShifts.ts` does, marking it
   * `superseded`) — this does not check, and relies on migration 018's
   * partial unique index to reject a genuine race rather than silently
   * allowing two open shifts on one register.
   */
  async createRegisterShift(payload: { registerId: string; userId: string }): Promise<DbRow> {
    try {
      const id = crypto.randomUUID();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO register_shifts (id, register_id, user_id, started_at, last_activity_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, payload.registerId, payload.userId, now, now, now);

      const row = this.db.prepare('SELECT * FROM register_shifts WHERE id = ?').get(id) as DbRow;
      return mapRegisterShift(row);
    } catch (error) {
      logger.error('Error creating register shift:', error);
      throw new DatabaseError('Failed to start shift');
    }
  }

  /** Guarded on `ended_at IS NULL` so ending an already-ended shift twice is a no-op, not a second event. */
  async endRegisterShift(shiftId: string, reason: string): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare('UPDATE register_shifts SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL')
        .run(Date.now(), reason, shiftId);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM register_shifts WHERE id = ?').get(shiftId) as DbRow;
      return mapRegisterShift(row);
    } catch (error) {
      logger.error('Error ending register shift:', error);
      throw new DatabaseError('Failed to end shift');
    }
  }

  /** Bump a shift's idle clock. Guarded on `ended_at IS NULL` so a stale client cannot revive an ended shift. */
  async touchRegisterShiftActivity(shiftId: string): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare('UPDATE register_shifts SET last_activity_at = ? WHERE id = ? AND ended_at IS NULL')
        .run(Date.now(), shiftId);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM register_shifts WHERE id = ?').get(shiftId) as DbRow;
      return mapRegisterShift(row);
    } catch (error) {
      logger.error('Error touching register shift activity:', error);
      throw new DatabaseError('Failed to record shift activity');
    }
  }

  // Register overrides (manager override — migration 019)

  /**
   * Mint a grant row. `shiftId` and `requestedByUserId` are nullable at the
   * schema level — a register can be authenticated with no shift open at
   * all, e.g. a `require_sign_in = false` till — so both simply go in as
   * given rather than being defaulted here.
   */
  async createRegisterOverride(payload: {
    registerId: string;
    shiftId: string | null;
    approverUserId: string;
    requestedByUserId: string | null;
    action: string;
    grantPrefix: string;
    grantHash: string;
    expiresAt: number;
    reason: string | null;
  }): Promise<DbRow> {
    try {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO register_overrides
            (id, register_id, shift_id, approver_user_id, requested_by_user_id, action,
             grant_prefix, grant_hash, expires_at, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          payload.registerId,
          payload.shiftId,
          payload.approverUserId,
          payload.requestedByUserId,
          payload.action,
          payload.grantPrefix,
          payload.grantHash,
          payload.expiresAt,
          payload.reason,
          Date.now()
        );

      const row = this.db.prepare('SELECT * FROM register_overrides WHERE id = ?').get(id) as DbRow;
      return mapRegisterOverride(row);
    } catch (error) {
      logger.error('Error creating register override:', error);
      throw new DatabaseError('Failed to create override grant');
    }
  }

  /**
   * Every row sharing a grant's 8-character prefix, spent or not — the
   * service layer does the bcrypt comparison and the state checks, same
   * shape as `getPairingCredentialsByPrefix`/`getRegisterCredentialsByTokenPrefix`.
   */
  async getRegisterOverridesByPrefix(prefix: string): Promise<DbRow[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM register_overrides WHERE grant_prefix = ?')
        .all(prefix) as DbRow[];
      return rows.map(mapRegisterOverride);
    } catch (error) {
      logger.error('Error getting register overrides by prefix:', error);
      throw new DatabaseError('Failed to get override grants');
    }
  }

  /**
   * Spend a grant. Guarded on `consumed_at IS NULL` so a race between two
   * concurrent consume attempts for the same grant can only ever succeed
   * once — the loser gets zero rows changed and reads back as null, the same
   * shape `redeemPairingCredential` uses for the equivalent race.
   */
  async consumeRegisterOverride(
    id: string,
    payload: { entity: string | null; entityId: string | null; beforeValue: string | null; afterValue: string | null }
  ): Promise<DbRow | null> {
    try {
      const result = this.db
        .prepare(
          `UPDATE register_overrides
           SET consumed_at = ?, entity = ?, entity_id = ?, before_value = ?, after_value = ?
           WHERE id = ? AND consumed_at IS NULL`
        )
        .run(Date.now(), payload.entity, payload.entityId, payload.beforeValue, payload.afterValue, id);
      if (result.changes === 0) return null;

      const row = this.db.prepare('SELECT * FROM register_overrides WHERE id = ?').get(id) as DbRow;
      return mapRegisterOverride(row);
    } catch (error) {
      logger.error('Error consuming register override:', error);
      throw new DatabaseError('Failed to consume override grant');
    }
  }

  /**
   * The override log for the admin listing route — every grant ever issued
   * in the org, spent or not, newest first. Scoped to `orgId` via a join on
   * `registers`, since `register_overrides` carries no `org_id` of its own.
   * Uses {@link mapRegisterOverrideSummary}, never the internal mapper: this
   * is the one path that hands override rows back to a route, and the grant
   * hash must never be part of that response.
   */
  async getRegisterOverrides(filter: {
    orgId: string;
    limit: number;
    offset: number;
    registerId?: string;
    approverUserId?: string;
  }): Promise<{ overrides: DbRow[]; total: number }> {
    try {
      const conditions = ['r.org_id = ?'];
      const params: unknown[] = [filter.orgId];
      if (filter.registerId) {
        conditions.push('o.register_id = ?');
        params.push(filter.registerId);
      }
      if (filter.approverUserId) {
        conditions.push('o.approver_user_id = ?');
        params.push(filter.approverUserId);
      }
      const where = conditions.join(' AND ');

      const { count } = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM register_overrides o
           JOIN registers r ON r.id = o.register_id
           WHERE ${where}`
        )
        .get(...params) as { count: number };

      const rows = this.db
        .prepare(
          `SELECT o.*,
                  a.name AS approver_name,
                  q.name AS requested_by_name,
                  r.display_code AS register_display_code
           FROM register_overrides o
           JOIN registers r ON r.id = o.register_id
           LEFT JOIN users a ON a.id = o.approver_user_id
           LEFT JOIN users q ON q.id = o.requested_by_user_id
           WHERE ${where}
           ORDER BY o.created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, filter.limit, filter.offset) as DbRow[];

      return { overrides: rows.map(mapRegisterOverrideSummary), total: Number(count) };
    } catch (error) {
      logger.error('Error getting register overrides:', error);
      throw new DatabaseError('Failed to get override log');
    }
  }

}
