import { Pool } from 'pg';
import logger from '../../utils/logger';
import { escapeLike } from './like';
import { DatabaseError, ValidationError } from '../../utils/errors';
import {
  DbRow,
  asRows,
  type PaymentAttempt,
  type PaymentAttemptCreate,
  type PaymentAttemptUpdate,
} from './types';
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

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
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

/**
 * Turn an `order_items` row into the camelCase DTO the API publishes.
 *
 * Shared by every path that returns order lines. It was previously inlined at
 * each read site and omitted entirely on create, which meant a completed sale
 * responded with raw snake_case columns while a subsequent read of the same
 * order came back camelCase - the client saw `undefined` for every line total
 * on the response it got immediately after checkout.
 *
 * DECIMAL columns arrive from `pg` as strings; the numeric fields are parsed
 * here so callers never have to.
 */
export function mapOrderItemRow(item: DbRow): DbRow {
  return {
    id: item.id,
    orderId: item.order_id,
    productId: item.product_id,
    variantId: item.variant_id,
    nameSnapshot: item.name_snapshot,
    size: item.size,
    color: item.color,
    quantity: item.quantity,
    unitPrice: parseFloat(item.unit_price as string),
    lineDiscount: parseFloat(item.line_discount as string),
    lineTotal: parseFloat(item.line_total as string),
    notes: item.notes,
  };
}

/** Turn an `orders` row into the camelCase DTO the API publishes. */
export function mapOrderRow(order: DbRow): DbRow {
  return {
    id: order.id,
    createdAt: new Date(order.created_at as string).getTime(),
    subtotal: parseFloat(order.subtotal as string),
    discountTotal: parseFloat(order.discount_total as string),
    taxTotal: parseFloat(order.tax_total as string),
    total: parseFloat(order.total as string),
    paymentMethod: order.payment_method,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    cardTransactionId: order.card_transaction_id ?? null,
    cardAuthCode: order.card_auth_code ?? null,
    // Null on card and other tenders, and on orders predating the columns.
    amountTendered: order.amount_tendered == null ? null : parseFloat(order.amount_tendered as string),
    changeGiven: order.change_given == null ? null : parseFloat(order.change_given as string),
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


/** Turn a `store_credits` row into the camelCase DTO the API publishes. */
export function mapStoreCreditRow(row: DbRow): DbRow {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerEmail: row.customer_email,
    returnId: row.return_id,
    code: row.code,
    originalAmount: parseFloat(row.original_amount as string),
    remainingAmount: parseFloat(row.remaining_amount as string),
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
    createdAt: new Date(row.created_at as string).getTime(),
    usedAt: row.used_at ? new Date(row.used_at as string).getTime() : null,
    usedOrderId: row.used_order_id,
  };
}


/** Turn a `cash_drawer_sessions` row into the camelCase DTO the API publishes. */
export function mapDrawerSessionRow(row: DbRow): DbRow {
  const money = (value: unknown) => (value == null ? null : parseFloat(value as string));

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
    openedAt: new Date(row.opened_at as string).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at as string).getTime() : null,
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
    amount: parseFloat(row.amount as string),
    reference: row.reference ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
    registerId: row.register_id ?? null,
  };
}



/** Turn a `product_variants` row into the camelCase DTO the API publishes. */
export function mapVariantRow(row: DbRow): DbRow {
  return {
    id: row.id,
    size: row.size,
    color: row.color,
    priceOverride: row.price_override == null ? null : parseFloat(row.price_override as string),
    priceDelta: row.price_delta == null ? null : parseFloat(row.price_delta as string),
    sku: row.sku,
    barcode: row.barcode,
    stock: row.stock,
    enabled: row.enabled,
    // Null means "use the store default", so a shop can change its mind about
    // what counts as low without editing every variant it owns.
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
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
}

/**
 * Turn a `registers` row into the camelCase DTO the API publishes.
 *
 * The five flag columns are coerced through `Boolean(...)` even though `pg`
 * already parses them as native booleans: it keeps this mapper's output
 * identical in shape to the SQLite adapter's, whose columns are `0`/`1` and
 * need the coercion to avoid serializing differently per environment.
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
    lastSeenAt: row.last_seen_at == null ? null : new Date(row.last_seen_at as string).getTime(),
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
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
    pairingExpiresAt: new Date(row.pairing_expires_at as string).getTime(),
    tokenPrefix: row.token_prefix ?? null,
    tokenHash: row.token_hash ?? null,
    enrolledAt: row.enrolled_at == null ? null : new Date(row.enrolled_at as string).getTime(),
    lastUsedAt: row.last_used_at == null ? null : new Date(row.last_used_at as string).getTime(),
    revokedAt: row.revoked_at == null ? null : new Date(row.revoked_at as string).getTime(),
    revokedBy: row.revoked_by ?? null,
    revokeReason: row.revoke_reason ?? null,
    createdBy: row.created_by ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
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
    pinSetAt: row.pin_set_at == null ? null : new Date(row.pin_set_at as string).getTime(),
    pinFailedCount: Number(row.pin_failed_count ?? 0),
    pinLockedUntil: row.pin_locked_until == null ? null : new Date(row.pin_locked_until as string).getTime(),
    canOverride: Boolean(row.can_override),
    lastLoginAt: row.last_login_at == null ? null : new Date(row.last_login_at as string).getTime(),
    createdAt: new Date(row.created_at as string).getTime(),
  };
}

/** Turn a `register_shifts` row into the camelCase DTO routes and services consume. */
function mapRegisterShift(row: DbRow): DbRow {
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    userId: String(row.user_id),
    // Cashier an admin was standing in for — see migration 020. NULL on every
    // ordinary shift; never the attributed identity, see `userId` above.
    emulatedUserId: row.emulated_user_id == null ? null : String(row.emulated_user_id),
    startedAt: new Date(row.started_at as string).getTime(),
    lastActivityAt: new Date(row.last_activity_at as string).getTime(),
    endedAt: row.ended_at == null ? null : new Date(row.ended_at as string).getTime(),
    endReason: row.end_reason ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
  };
}

/**
 * A shift row for the admin shift log, with the names joined in.
 *
 * Separate from {@link mapRegisterShift} because that one is the till's
 * internal shape — the shift the register is standing on — and carries no
 * display fields. This is the reporting shape: a table of raw UUIDs cannot
 * answer "who was on this till", which is the only reason the log exists.
 */
function mapRegisterShiftSummary(row: DbRow): DbRow {
  return {
    ...mapRegisterShift(row),
    cashierName: row.cashier_name ?? null,
    cashierEmail: row.cashier_email ?? null,
    emulatedUserName: row.emulated_user_name ?? null,
    registerName: row.register_name ?? null,
    registerDisplayCode: row.register_display_code ?? null,
    locationName: row.location_name ?? null,
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
    expiresAt: new Date(row.expires_at as string).getTime(),
    consumedAt: row.consumed_at == null ? null : new Date(row.consumed_at as string).getTime(),
    entity: row.entity ?? null,
    entityId: row.entity_id ?? null,
    beforeValue: row.before_value ?? null,
    afterValue: row.after_value ?? null,
    reason: row.reason ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
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
    expiresAt: new Date(row.expires_at as string).getTime(),
    consumedAt: row.consumed_at == null ? null : new Date(row.consumed_at as string).getTime(),
    entity: row.entity ?? null,
    entityId: row.entity_id ?? null,
    beforeValue: row.before_value ?? null,
    afterValue: row.after_value ?? null,
    reason: row.reason ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
    // Joined for display. This log exists to answer "who authorised what", and
    // a table of raw UUIDs cannot answer it.
    approverName: row.approver_name ?? null,
    requestedByName: row.requested_by_name ?? null,
    registerDisplayCode: row.register_display_code ?? null,
  };
}

/**
 * Whether a Postgres error is "that text is not a valid value for this column
 * type" — in practice, a malformed id where a UUID was expected.
 *
 * SQLite stores ids as TEXT and simply matches nothing, so the two adapters
 * disagree about a bad id unless this is translated: Postgres raises 22P02 and
 * the route turns a user's typo into a 500 with a stack trace, where SQLite
 * quietly 404s. Treating it as "not found" makes the dialects behave alike and
 * keeps malformed input out of the error monitoring that should be reserved for
 * real faults.
 */
function isInvalidTextRepresentation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '22P02';
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
  async getUserByEmail(email: string): Promise<Record<string, unknown> | null> {
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
      let roles: unknown[] = [];
      if (user.roles) {
        try {
          const rolesArray = typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles;
          if (Array.isArray(rolesArray)) {
            roles = rolesArray.map((r: Record<string, unknown>) => ({
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
        // Null until a second organization exists; `authenticate` falls back to
        // the default org so consumers never see an absent tenant.
        orgId: user.org_id ?? null,
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

  /**
   * The catalog, optionally searched, filtered, and paged.
   *
   * `limit` is opt-in and there is deliberately **no default cap**. Quietly
   * capping this would drop products off the end of the register with no
   * indication — the page shows what it was given, so the failure looks like a
   * missing product rather than a truncated response. A default belongs with a
   * register that pages, not before it.
   *
   * Search covers name, barcode, and variant SKU/barcode, case-insensitively,
   * because those are the three things someone types when hunting for an item.
   */
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
        params.push(`%${escapeLike(query.q)}%`);
        const like = `$${params.length}`;
        // EXISTS rather than a join condition: a match on one variant's SKU
        // should return the product with *all* its variants, not just that one.
        conditions.push(`(
          p.name ILIKE ${like}
          OR p.barcode ILIKE ${like}
          OR EXISTS (
            SELECT 1 FROM product_variants v
            WHERE v.product_id = p.id AND (v.sku ILIKE ${like} OR v.barcode ILIKE ${like})
          )
        )`);
      }

      if (query.category) {
        params.push(query.category);
        conditions.push(`p.category = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await this.pool.query(
        `SELECT COUNT(*)::int AS total FROM products p ${where}`,
        params
      );

      let paging = '';
      if (query.limit != null) {
        params.push(query.limit);
        paging += ` LIMIT $${params.length}`;
      }
      if (query.offset != null) {
        params.push(query.offset);
        paging += ` OFFSET $${params.length}`;
      }

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
                    'enabled', pv.enabled,
                    'lowStockThreshold', pv.low_stock_threshold
                  )
                  -- Deterministic, because json_agg has no inherent order and
                  -- an UPDATE moves a row in the heap: without this a product's
                  -- variants silently reorder between page loads, and again
                  -- after any stock edit. Ordered by what a person reads -
                  -- size, then colour - with sku as the tiebreak so two
                  -- otherwise-identical variants still sort stably.
                  ORDER BY pv.size, pv.color, pv.sku
                ) FILTER (WHERE pv.id IS NOT NULL) as variants
         FROM products p
         LEFT JOIN product_variants pv ON p.id = pv.product_id
         ${where}
         GROUP BY p.id
         ORDER BY p.name ASC${paging}`,
        params
      );

      const products = result.rows.map((row) => ({
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

      return { products, total: countResult.rows[0].total };
    } catch (error) {
      logger.error('Error getting all products:', error);
      throw new DatabaseError('Failed to get products');
    }
  }

  async getProductById(id: string): Promise<Record<string, unknown> | null> {
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
                    'enabled', pv.enabled,
                    'lowStockThreshold', pv.low_stock_threshold
                  )
                  -- Deterministic, because json_agg has no inherent order and
                  -- an UPDATE moves a row in the heap: without this a product's
                  -- variants silently reorder between page loads, and again
                  -- after any stock edit. Ordered by what a person reads -
                  -- size, then colour - with sku as the tiebreak so two
                  -- otherwise-identical variants still sort stably.
                  ORDER BY pv.size, pv.color, pv.sku
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

  async createProduct(product: Record<string, unknown>): Promise<Record<string, unknown>> {
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
      if (Array.isArray(product.variants) && product.variants.length > 0) {
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

  async updateProduct(id: string, product: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      // COALESCE, not bare assignment: every field on the update schema is
      // optional, so a caller changing only the price sends nothing else. Writing
      // the parameters straight through set those columns to NULL - erasing the
      // description, category, image, and barcode of any product updated in part,
      // and failing outright on `name`, which is NOT NULL.
      const result = await this.pool.query(
        `UPDATE products 
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             category = COALESCE($3, category),
             base_price = COALESCE($4, base_price),
             image = COALESCE($5, image),
             barcode = COALESCE($6, barcode),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [
          product.name ?? null,
          product.description ?? null,
          product.category ?? null,
          product.basePrice ?? null,
          product.image ?? null,
          product.barcode ?? null,
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
  async createOrder(order: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert order
      const orderResult = await client.query(
        `INSERT INTO orders (subtotal, discount_total, tax_total, total, payment_method, customer_email, customer_phone, card_transaction_id, card_auth_code, amount_tendered, change_given, register_id, cashier_user_id, drawer_session_id, override_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
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
          order.overrideByUserId ?? null,
        ]
      );

      const newOrder = orderResult.rows[0];

      // Insert order items and update stock
      const items = [];
      if (Array.isArray(order.items) && order.items.length > 0) {
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

          // Decrement stock, conditionally.
          //
          // `WHERE stock >= $1` is what makes this safe under concurrency: the
          // repricing pass checks stock before this transaction opens, so two
          // registers selling the last unit can both pass that check. The row
          // lock here means only one of them matches, and the other updates
          // nothing and rolls the whole order back.
          //
          // The previous `GREATEST(0, stock - $1)` did the opposite - it clamped
          // at zero and reported success, so an oversold item silently sat at 0
          // stock while both sales were recorded.
          if (item.variantId) {
            const stockResult = await client.query(
              `UPDATE product_variants 
               SET stock = stock - $1
               WHERE id = $2 AND stock >= $1`,
              [item.quantity, item.variantId]
            );

            if (stockResult.rowCount === 0) {
              throw new ValidationError(
                `Not enough stock for "${item.nameSnapshot ?? item.productId}"`
              );
            }
          }
        }
      }

      // Payments, and any store credit they spend, inside the same transaction as
      // the order and its stock movements. Redeeming a credit in a separate step
      // would mean a failure between the two either burns a credit for a sale
      // that never happened, or records a sale paid with a credit still worth
      // its full value.
      const payments = [];
      if (Array.isArray(order.payments)) {
        for (const payment of order.payments as Array<Record<string, unknown>>) {
          if (payment.method === 'store_credit') {
            const redeemed = await client.query(
              `UPDATE store_credits
               SET remaining_amount = remaining_amount - $2,
                   status = CASE WHEN remaining_amount - $2 <= 0 THEN 'used' ELSE status END,
                   used_at = CASE WHEN remaining_amount - $2 <= 0 THEN NOW() ELSE used_at END,
                   used_order_id = $3
               WHERE UPPER(code) = UPPER($1)
                 AND status = 'active'
                 AND remaining_amount >= $2
                 AND (expires_at IS NULL OR expires_at > NOW())
               RETURNING id`,
              [payment.reference, payment.amount, newOrder.id]
            );

            if (redeemed.rowCount === 0) {
              throw new ValidationError(
                'That store credit is not available for the amount requested'
              );
            }
          }

          const inserted = await client.query(
            `INSERT INTO payments (order_id, method, amount, reference, register_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
              newOrder.id,
              payment.method,
              payment.amount,
              payment.reference ?? null,
              order.registerId ?? null,
            ]
          );
          payments.push(mapPaymentRow(inserted.rows[0]));
        }
      }

      await client.query('COMMIT');

      return {
        ...mapOrderRow(newOrder),
        items: items.map(mapOrderItemRow),
        payments,
      };
    } catch (error) {
      await client.query('ROLLBACK');

      // A stock conflict is the caller's problem, not the server's: let it
      // through as the 400 it is, rather than flattening it into a generic
      // "Failed to create order" 500 that tells the cashier nothing.
      if (error instanceof ValidationError) throw error;

      logger.error('Error creating order:', error);
      throw new DatabaseError('Failed to create order');
    } finally {
      client.release();
    }
  }

  async getAllOrders(): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM orders ORDER BY created_at DESC`
      );

      // Get all order items in one query for efficiency
      const orderIds = result.rows.map(o => o.id);
      const itemsMap = new Map<string, unknown[]>();
      
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
          itemsMap.get(orderId)!.push(mapOrderItemRow(item));
        });
      }

      return result.rows.map((order) => ({
        ...mapOrderRow(order),
        items: itemsMap.get(order.id) || [],
      }));
    } catch (error) {
      logger.error('Error getting all orders:', error);
      throw new DatabaseError('Failed to get orders');
    }
  }

  async getOrderById(id: string): Promise<Record<string, unknown> | null> {
    try {
      const orderResult = await this.pool.query(
        // Joined so a receipt can name the till and the cashier rather than
        // print two UUIDs. LEFT JOINs: an order predating registers, or one
        // rung before PIN sign-in existed, still has to render.
        `SELECT o.*,
                r.display_code AS register_display_code,
                u.name AS cashier_name
         FROM orders o
         LEFT JOIN registers r ON r.id = o.register_id
         LEFT JOIN users u ON u.id = o.cashier_user_id
         WHERE o.id = $1`,
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

      // Payments belong on the detail view: without them a receipt cannot show
      // how a split sale was actually paid, only the 'Split' summary.
      const paymentsResult = await this.pool.query(
        'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at',
        [id]
      );

      return {
        ...mapOrderRow(order),
        items: itemsResult.rows.map(mapOrderItemRow),
        payments: paymentsResult.rows.map(mapPaymentRow),
      };
    } catch (error) {
      logger.error('Error getting order by ID:', error);
      throw new DatabaseError('Failed to get order');
    }
  }

  async getAllCustomers(): Promise<DbRow[]> {
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

  async createCustomer(customer: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async getCustomerById(id: string): Promise<Record<string, unknown> | null> {
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

  async updateCustomer(id: string, customer: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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

  async archiveCustomer(id: string, archivedBy: string, reason?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get customer data
      const customerResult = await client.query(
        'SELECT * FROM customers WHERE id = $1',
        [id]
      );

      if (customerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const customer = customerResult.rows[0];

      // Insert into archived_customers
      await client.query(
        `INSERT INTO archived_customers 
         (id, name, email, phone, organization, address, city, state, zip, country, notes, 
          created_at, updated_at, archived_by, archive_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          customer.id, customer.name, customer.email, customer.phone, customer.org,
          customer.address, customer.city, customer.state, customer.zip, customer.country,
          customer.notes, customer.created_at, customer.updated_at, archivedBy, reason
        ]
      );

      // Archive associated quotes.
      //
      // They have to move: `quotes.customer_id` is a foreign key with NO ACTION,
      // so deleting the customer while a quote points at them simply fails.
      //
      // The column names differ between the live table and the archive, and the
      // previous version read `quote.tax` and `quote.valid_until` — neither of
      // which exists. `SELECT *` yields undefined for those, which reaches
      // Postgres as NULL, so an archive whose entire purpose is preserving the
      // record was storing it with the tax and the expiry blanked.
      const quotesResult = await client.query('SELECT * FROM quotes WHERE customer_id = $1', [id]);

      for (const quote of quotesResult.rows) {
        // Line items live in their own table; folded into the archive's `items`
        // JSON so they survive the quote row being deleted.
        const itemsResult = await client.query(
          'SELECT * FROM quote_items WHERE quote_id = $1',
          [quote.id]
        );

        await client.query(
          `INSERT INTO archived_quotes
           (id, customer_id, status, items, subtotal, tax, total, notes, valid_until, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            quote.id,
            quote.customer_id,
            quote.status,
            JSON.stringify(itemsResult.rows),
            quote.subtotal,
            quote.tax_total,
            quote.total,
            quote.notes,
            quote.expires_at,
            quote.created_at,
          ]
        );
      }

      // Orders are deliberately left alone.
      //
      // The previous version selected `FROM orders WHERE customer_id = $1` and
      // then deleted the matches. `orders` has no `customer_id` — it records
      // `customer_email` as a snapshot — so that query raised "column
      // customer_id does not exist" and archiving **any** customer failed with
      // a 500. The feature had never worked.
      //
      // Deleting them would have been worse than the crash: orders are the
      // sales ledger, they are what returns and reporting read, and a customer
      // asking to be archived is not a reason to erase the shop's record of
      // what it sold. They carry the email as a snapshot, so they survive the
      // customer row going away without any dangling reference.

      await client.query('DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE customer_id = $1)', [id]);
      await client.query('DELETE FROM quotes WHERE customer_id = $1', [id]);
      await client.query('DELETE FROM customers WHERE id = $1', [id]);

      await client.query('COMMIT');
      logger.info(`Customer ${id} archived successfully`);
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error archiving customer:', error);
      throw new DatabaseError('Failed to archive customer');
    } finally {
      client.release();
    }
  }

  async permanentDeleteCustomer(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if customer exists and get their email (needed for orders lookup)
      const customerResult = await client.query(
        'SELECT id, email FROM customers WHERE id = $1',
        [id]
      );

      if (customerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      
      const customerEmail = customerResult.rows[0].email;

      // Get all return IDs for this customer (returns has customer_id)
      const returnIds = await client.query(
        'SELECT id FROM returns WHERE customer_id = $1',
        [id]
      );
      
      // Get all order IDs for this customer (orders uses customer_email, not customer_id)
      const orderIds = customerEmail 
        ? await client.query('SELECT id FROM orders WHERE customer_email = $1', [customerEmail])
        : { rows: [] };

      // Delete all related records first (order matters due to foreign keys)
      // 1. Delete refund_transactions by return_id or order_id
      if (returnIds.rows.length > 0) {
        const returnIdList = returnIds.rows.map(r => r.id);
        await client.query('DELETE FROM refund_transactions WHERE return_id = ANY($1)', [returnIdList]);
        await client.query('DELETE FROM receipt_emails WHERE return_id = ANY($1)', [returnIdList]);
      }
      if (orderIds.rows.length > 0) {
        const orderIdList = orderIds.rows.map((o: Record<string, unknown>) => o.id as string);
        await client.query('DELETE FROM refund_transactions WHERE order_id = ANY($1)', [orderIdList]);
        await client.query('DELETE FROM receipt_emails WHERE order_id = ANY($1)', [orderIdList]);
        // Delete discount_usage and loyalty_transactions for these orders
        await client.query('DELETE FROM discount_usage WHERE order_id = ANY($1)', [orderIdList]);
        await client.query('DELETE FROM loyalty_transactions WHERE order_id = ANY($1)', [orderIdList]);
        // Delete store credits that were used on these orders
        await client.query('DELETE FROM store_credits WHERE used_order_id = ANY($1)', [orderIdList]);
      }
      
      // 2. Delete store_credits (has customer_id directly and return_id)
      await client.query('DELETE FROM store_credits WHERE customer_id = $1', [id]);
      if (returnIds.rows.length > 0) {
        const returnIdList = returnIds.rows.map(r => r.id);
        await client.query('DELETE FROM store_credits WHERE return_id = ANY($1)', [returnIdList]);
      }
      
      // 3. Delete returns (return_items cascade automatically)
      await client.query('DELETE FROM returns WHERE customer_id = $1', [id]);
      
      // 4. Delete quotes (has customer_id)
      await client.query('DELETE FROM quotes WHERE customer_id = $1', [id]);
      
      // 5. Delete orders (uses customer_email) - order_items cascade automatically
      if (customerEmail) {
        await client.query('DELETE FROM orders WHERE customer_email = $1', [customerEmail]);
      }
      
      // 6. Finally delete the customer
      await client.query('DELETE FROM customers WHERE id = $1', [id]);

      await client.query('COMMIT');
      logger.info(`Customer ${id} permanently deleted`);
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error permanently deleting customer:', error);
      throw new DatabaseError('Failed to permanently delete customer');
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL connection pool closed');
  }

  // ===== Service Operations =====
  async getAllServices(): Promise<DbRow[]> {
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

  async createService(service: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateService(id: string, service: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
  async getAllUsers(): Promise<DbRow[]> {
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

      // Hand-picked, never `...u`: the row carries `pin_hash`, and a spread
      // here would put every cashier's PIN hash on the wire the moment a route
      // returned this list. The PIN fields that ARE here say only whether a PIN
      // exists and whether it is currently locked out, which is what the admin
      // screen needs to offer an unlock.
      return result.rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        roleIds: u.role_ids || [],
        roles: u.roles || [],
        pinSetAt: u.pin_set_at ? new Date(u.pin_set_at).getTime() : null,
        pinLockedUntil: u.pin_locked_until ? new Date(u.pin_locked_until).getTime() : null,
        lastLoginAt: u.last_login_at ? new Date(u.last_login_at).getTime() : null,
        createdAt: new Date(u.created_at).getTime(),
      }));
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw new DatabaseError('Failed to get users');
    }
  }

  async createUser(user: Record<string, unknown>): Promise<Record<string, unknown>> {
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
      if (Array.isArray(user.roleIds) && user.roleIds.length > 0) {
        for (const roleId of asRows(user.roleIds)) {
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

  async updateUser(id: string, user: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const updates: string[] = [];
      const values: unknown[] = [];
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
      // Whether this person may approve a manager override. Without a way to
      // set it, `can_override` would be false for everybody and the override
      // flow would be unreachable in production.
      if (user.canOverride !== undefined) {
        updates.push(`can_override = $${paramIndex++}`);
        values.push(Boolean(user.canOverride));
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
        for (const roleId of asRows(user.roleIds)) {
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
  async getAllRoles(): Promise<DbRow[]> {
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

  async createRole(role: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateRole(id: string, role: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
        // Receipt branding
        storeAddress: s.store_address,
        storeCity: s.store_city,
        storeState: s.store_state,
        storeZip: s.store_zip,
        storeNumber: s.store_number,
        receiptLogoUrl: s.receipt_logo_url,
        receiptHeaderText: s.receipt_header_text,
        receiptFooterText: s.receipt_footer_text,
        receiptShowLogo: s.receipt_show_logo !== false,
        receiptShowBarcode: s.receipt_show_barcode !== false,
      };
    } catch (error) {
      logger.error('Error getting settings:', error);
      throw new DatabaseError('Failed to get settings');
    }
  }

  async updateSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      // Build dynamic update query for all fields
      const result = await this.pool.query(
        `INSERT INTO settings (
          id, tax_rate_default, store_name, store_email, store_phone, timezone, 
          logo_url, icon_url, brand_color, config,
          store_address, store_city, store_state, store_zip, store_number,
          receipt_logo_url, receipt_header_text, receipt_footer_text, receipt_show_logo, receipt_show_barcode
        )
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (id) DO UPDATE SET
           tax_rate_default = COALESCE($1, settings.tax_rate_default),
           store_name = COALESCE($2, settings.store_name),
           store_email = COALESCE($3, settings.store_email),
           store_phone = COALESCE($4, settings.store_phone),
           timezone = COALESCE($5, settings.timezone),
           logo_url = COALESCE($6, settings.logo_url),
           icon_url = COALESCE($7, settings.icon_url),
           brand_color = COALESCE($8, settings.brand_color),
           config = COALESCE($9, settings.config),
           store_address = COALESCE($10, settings.store_address),
           store_city = COALESCE($11, settings.store_city),
           store_state = COALESCE($12, settings.store_state),
           store_zip = COALESCE($13, settings.store_zip),
           store_number = COALESCE($14, settings.store_number),
           receipt_logo_url = COALESCE($15, settings.receipt_logo_url),
           receipt_header_text = COALESCE($16, settings.receipt_header_text),
           receipt_footer_text = COALESCE($17, settings.receipt_footer_text),
           receipt_show_logo = COALESCE($18, settings.receipt_show_logo),
           receipt_show_barcode = COALESCE($19, settings.receipt_show_barcode)
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
          settings.storeAddress,
          settings.storeCity,
          settings.storeState,
          settings.storeZip,
          settings.storeNumber,
          settings.receiptLogoUrl,
          settings.receiptHeaderText,
          settings.receiptFooterText,
          settings.receiptShowLogo,
          settings.receiptShowBarcode,
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
        storeAddress: s.store_address,
        storeCity: s.store_city,
        storeState: s.store_state,
        storeZip: s.store_zip,
        storeNumber: s.store_number,
        receiptLogoUrl: s.receipt_logo_url,
        receiptHeaderText: s.receipt_header_text,
        receiptFooterText: s.receipt_footer_text,
        receiptShowLogo: s.receipt_show_logo !== false,
        receiptShowBarcode: s.receipt_show_barcode !== false,
      };
    } catch (error) {
      logger.error('Error updating settings:', error);
      throw new DatabaseError('Failed to update settings');
    }
  }

  // ===== Audit Log Operations =====
  async createAuditLog(log: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const result = await this.pool.query(
        `INSERT INTO audit_logs (user_id, actor_label, action, entity, entity_id, before, after)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          log.userId ?? null,
          log.actorLabel ?? null,
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
        actorLabel: l.actor_label,
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

  /**
   * A page of the audit trail, with the total it was drawn from.
   *
   * The count is what makes this paginable: without it a caller cannot tell a
   * short last page from the end of the log, and the screen above this was
   * loading the newest hundred rows and filtering them in the browser — a
   * search box that looked like it searched the audit log and searched one page
   * of it.
   *
   * Filters are applied in SQL for the same reason. `WHERE` is assembled from a
   * list of conditions rather than by appending, so adding one cannot depend on
   * whether it happens to be first.
   */
  async getAuditLogs(options?: AuditLogQuery): Promise<{ logs: DbRow[]; total: number }> {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options?.userId) {
        params.push(options.userId);
        conditions.push(`al.user_id = $${params.length}`);
      }
      if (options?.entity) {
        params.push(options.entity);
        conditions.push(`al.entity = $${params.length}`);
      }
      if (options?.action) {
        params.push(options.action);
        conditions.push(`al.action = $${params.length}`);
      }
      if (options?.from !== undefined) {
        params.push(options.from);
        conditions.push(`al.timestamp >= to_timestamp($${params.length} / 1000.0)`);
      }
      if (options?.to !== undefined) {
        params.push(options.to);
        conditions.push(`al.timestamp <= to_timestamp($${params.length} / 1000.0)`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await this.pool.query(
        `SELECT COUNT(*) as total FROM audit_logs al ${where}`,
        params
      );

      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;

      const result = await this.pool.query(
        `SELECT al.*, u.name as user_name, u.email as user_email
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         ${where}
         ORDER BY al.timestamp DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return {
        logs: result.rows.map((l) => ({
          id: l.id,
          timestamp: new Date(l.timestamp).getTime(),
          userId: l.user_id,
          userName: l.user_name,
          userEmail: l.user_email,
          actorLabel: l.actor_label,
          action: l.action,
          entity: l.entity,
          entityId: l.entity_id,
          before: l.before,
          after: l.after,
        })),
        total: parseInt(countResult.rows[0].total, 10),
      };
    } catch (error) {
      logger.error('Error getting audit logs:', error);
      throw new DatabaseError('Failed to get audit logs');
    }
  }

  // ===== Quote Operations =====
  async getAllQuotes(): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT q.*, c.name as customer_name, c.email as customer_email
         FROM quotes q
         LEFT JOIN customers c ON q.customer_id = c.id
         ORDER BY q.created_at DESC`
      );

      // Get all quote items
      const quoteIds = result.rows.map(q => q.id);
      const itemsMap = new Map<string, unknown[]>();

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

  async getQuotesByCustomer(customerId: string): Promise<DbRow[]> {
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
      const itemsMap = new Map<string, unknown[]>();

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

  async createQuote(quote: Record<string, unknown>): Promise<Record<string, unknown>> {
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
          quote.expiresAt ? new Date(quote.expiresAt as string) : null,
        ]
      );

      const newQuote = quoteResult.rows[0];
      const items = [];

      if (Array.isArray(quote.items) && quote.items.length > 0) {
        for (const item of asRows(quote.items)) {
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

  async updateQuote(id: string, quote: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
          quote.expiresAt ? new Date(quote.expiresAt as string) : null,
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
        for (const item of asRows(quote.items)) {
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
  async getOrdersByCustomerEmail(email: string): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM orders WHERE customer_email = $1 ORDER BY created_at DESC`,
        [email]
      );

      const orderIds = result.rows.map(o => o.id);
      const itemsMap = new Map<string, unknown[]>();

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
          itemsMap.get(orderId)!.push(mapOrderItemRow(item));
        });
      }

      return result.rows.map((order) => ({
        ...mapOrderRow(order),
        items: itemsMap.get(order.id) || [],
      }));
    } catch (error) {
      logger.error('Error getting orders by customer email:', error);
      throw new DatabaseError('Failed to get orders');
    }
  }

  // ===== API Key Operations =====
  async getAllApiKeys(): Promise<DbRow[]> {
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

  async createApiKey(apiKey: Record<string, unknown>): Promise<Record<string, unknown>> {
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
          apiKey.expiresAt ? new Date(apiKey.expiresAt as string) : null,
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

  async updateApiKey(id: string, apiKey: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
          apiKey.expiresAt ? new Date(apiKey.expiresAt as string) : null,
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

  async getReturnsByOrder(orderId: string): Promise<DbRow[]> {
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

      // Items for every return in one query, not one query per return.
      //
      // This is on the path a cashier takes to process a return: the caller uses
      // `originalOrderItemId` to work out how much of each order line has
      // already been refunded, which is what stops the same item being returned
      // twice. `getAllOrders` already batches this way.
      const returnIds = returns.map(r => r.id);
      const itemsByReturn = new Map<string, unknown[]>();

      if (returnIds.length > 0) {
        const itemsResult = await this.pool.query(
          'SELECT * FROM return_items WHERE return_id = ANY($1::uuid[])',
          [returnIds]
        );

        for (const item of itemsResult.rows) {
          const bucket = itemsByReturn.get(item.return_id) ?? [];
          bucket.push({
            id: item.id,
            originalOrderItemId: item.original_order_item_id,
            productId: item.product_id,
            variantId: item.variant_id,
            nameSnapshot: item.name_snapshot,
            returnQuantity: item.return_quantity,
            unitPrice: parseFloat(item.unit_price),
            lineTotal: parseFloat(item.line_total),
          });
          itemsByReturn.set(item.return_id, bucket);
        }
      }

      for (const ret of returns) {
        ret.items = itemsByReturn.get(ret.id as string) ?? [];
      }

      return returns;
    } catch (error) {
      logger.error('Error getting returns by order:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  /**
   * Returns against many orders at once, without their line items.
   *
   * The receipts list needs only each return's status and total, to work out
   * what a sale actually kept. Calling `getReturnsByOrder` per row cost two
   * queries per order — a hundred round trips to render a page of fifty
   * receipts. Items are deliberately not fetched: nothing on that screen reads
   * them, and they are the expensive half.
   *
   * Each row carries `originalOrderId` so the caller can group them.
   */
  async getReturnSummariesByOrderIds(orderIds: string[]): Promise<DbRow[]> {
    if (orderIds.length === 0) return [];

    try {
      const result = await this.pool.query(
        `SELECT r.*, u.name as created_by_name
         FROM returns r
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.original_order_id = ANY($1::uuid[])
         ORDER BY r.created_at DESC`,
        [orderIds]
      );

      return result.rows.map(r => this.mapReturnRow(r));
    } catch (error) {
      logger.error('Error getting returns for orders:', error);
      throw new DatabaseError('Failed to get returns');
    }
  }

  async getReturnsByCustomer(customerId: string): Promise<DbRow[]> {
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

  async createReturn(returnData: Record<string, unknown>): Promise<Record<string, unknown>> {
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
          restock_items, restocking_fee, created_by,
          register_id, cashier_user_id, override_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
          returnData.registerId ?? null,
          returnData.cashierUserId ?? null,
          returnData.overrideByUserId ?? null,
        ]
      );

      const returnId = returnResult.rows[0].id;

      // Insert return items
      for (const item of asRows(returnData.items)) {
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

  async updateReturnRefundStatus(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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

  async getReturnStats(filters?: { startDate?: number; endDate?: number }): Promise<Record<string, unknown>> {
    try {
      let whereClause = '';
      const params: unknown[] = [];

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

  async createRefundTransaction(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const status = (data.status as string) || 'completed';
      // Only a real completion time. Stamping this on a pending or failed
      // refund would make the column useless for telling settled money from
      // merely attempted money — which is the question it exists to answer.
      const completedAt = status === 'completed' || status === 'succeeded' ? new Date() : null;
      const result = await this.pool.query(
        `INSERT INTO refund_transactions (
          return_id, order_id, transaction_type, amount, currency,
          payment_method, processor_transaction_id, processor_response,
          status, failure_reason, processed_by, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          data.returnId,
          data.orderId,
          data.transactionType,
          data.amount,
          data.currency || 'USD',
          data.paymentMethod,
          data.processorTransactionId,
          data.processorResponse ?? null,
          status,
          data.failureReason ?? null,
          data.processedBy,
          completedAt,
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating refund transaction:', error);
      throw new DatabaseError('Failed to create refund transaction');
    }
  }

  async createStoreCredit(data: Record<string, unknown>): Promise<Record<string, unknown>> {
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

      return mapStoreCreditRow(result.rows[0]);
    } catch (error) {
      logger.error('Error creating store credit:', error);
      throw new DatabaseError('Failed to create store credit');
    }
  }

  async getStoreCreditByCode(code: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM store_credits WHERE UPPER(code) = UPPER($1)',
        [code]
      );
      return result.rows[0] ? mapStoreCreditRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting store credit:', error);
      throw new DatabaseError('Failed to get store credit');
    }
  }

  /**
   * Spend part or all of a store credit.
   *
   * The balance check lives in the `WHERE` clause, not in a read beforehand:
   * two registers presented with the same code would both pass a prior read and
   * both spend it. Here the row lock means only one matches, and the other gets
   * `null` to report as insufficient.
   */
  async redeemStoreCredit(
    code: string,
    amount: number,
    orderId?: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.pool.query(
        `UPDATE store_credits
         SET remaining_amount = remaining_amount - $2,
             status = CASE WHEN remaining_amount - $2 <= 0 THEN 'used' ELSE status END,
             used_at = CASE WHEN remaining_amount - $2 <= 0 THEN NOW() ELSE used_at END,
             used_order_id = COALESCE($3, used_order_id)
         WHERE UPPER(code) = UPPER($1)
           AND status = 'active'
           AND remaining_amount >= $2
           AND (expires_at IS NULL OR expires_at > NOW())
         RETURNING *`,
        [code, amount, orderId ?? null]
      );

      return result.rows[0] ? mapStoreCreditRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error redeeming store credit:', error);
      throw new DatabaseError('Failed to redeem store credit');
    }
  }

  async restockReturnItems(returnId: string, itemIds?: string[]): Promise<DbRow[]> {
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
      const restockedItems: DbRow[] = [];

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
      const params: unknown[] = [];
      let paramIndex = 1;

      if (filters.query) {
        query += ` AND (o.id::text ILIKE $${paramIndex} OR o.customer_email ILIKE $${paramIndex})`;
        // Escaped for the same reason as the catalog search: unescaped, a `%`
        // matches every order, so a cashier looking up one receipt is handed
        // the entire sales history. `_` is subtler — it matches any single
        // character, so `a_a` quietly returns `ada`.
        params.push(`%${escapeLike(filters.query)}%`);
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
        ...mapOrderRow(order),
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
      registerId: row.register_id ?? null,
      cashierUserId: row.cashier_user_id ?? null,
      overrideByUserId: row.override_by_user_id ?? null,
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
      const values: unknown[] = [];
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
      const values: unknown[] = [];
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
      const params: unknown[] = [];
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
      const params: unknown[] = [];

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

  // ===== Reporting Aggregations =====
  //
  // Summed in SQL rather than in the API. The reports screens used to fetch
  // every order and add them up in the browser, which is why the list adapters
  // still have no LIMIT: capping them would not have slowed those pages down,
  // it would have made them report a fraction of the day's takings as the whole.
  //
  // Timestamps are compared with `to_timestamp(ms / 1000.0)`, matching
  // `getDiscountStats` and the way the row mappers read `created_at` back. Both
  // ends are inclusive; the service decides what instant a date means.
  //
  // `RegisterFilter` narrows every one of these, threaded through as an
  // additional, optional predicate starting at whatever `$n` the query's own
  // parameters leave off. `locationIds` is always expressed as a subquery
  // against `registers` rather than an extra JOIN, so it applies uniformly
  // whether or not the query already joins that table. Unlike the SQLite
  // adapter's `?` placeholders, a `$n` placeholder can be referenced more than
  // once in a query without repeating the value in the params array — used by
  // `getPaymentMix` below, whose two UNION branches share one filter clause.

  /**
   * Builds ` AND ...` fragments for a {@link RegisterFilter}, `$n`-parameterised
   * starting at `nextIndex`.
   *
   * `registerCol`/`cashierCol` are the columns on the query's own rows —
   * `o.register_id`, `r.id`, `s.register_id`, whatever the caller already
   * joined to. An empty array in the filter is treated as "not filtering on
   * this field", same as `undefined`.
   */
  private registerFilterSQL(
    filter: RegisterFilter | undefined,
    registerCol: string,
    cashierCol: string | undefined,
    nextIndex: number
  ): { clause: string; params: unknown[]; nextIndex: number } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let idx = nextIndex;

    if (filter?.registerIds?.length) {
      parts.push(`${registerCol} = ANY($${idx}::uuid[])`);
      params.push(filter.registerIds);
      idx += 1;
    }
    if (filter?.locationIds?.length) {
      parts.push(
        `${registerCol} IN (SELECT id FROM registers WHERE location_id = ANY($${idx}::uuid[]))`
      );
      params.push(filter.locationIds);
      idx += 1;
    }
    if (cashierCol && filter?.cashierUserIds?.length) {
      parts.push(`${cashierCol} = ANY($${idx}::uuid[])`);
      params.push(filter.cashierUserIds);
      idx += 1;
    }

    return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params, nextIndex: idx };
  }

  async getSalesTotals(range: ReportRange, filter?: RegisterFilter): Promise<SalesTotals> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'register_id',
        'cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           COUNT(*) as order_count,
           COALESCE(SUM(subtotal), 0) as gross,
           COALESCE(SUM(discount_total), 0) as discounts,
           COALESCE(SUM(tax_total), 0) as tax,
           COALESCE(SUM(total), 0) as net
         FROM orders
         WHERE created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)${clause}`,
        [range.from, range.to, ...filterParams]
      );

      const row = result.rows[0];
      return {
        orderCount: parseInt(row.order_count, 10),
        gross: parseFloat(row.gross),
        discounts: parseFloat(row.discounts),
        tax: parseFloat(row.tax),
        net: parseFloat(row.net),
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
        'cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           to_char(created_at, 'YYYY-MM-DD') as date,
           COUNT(*) as order_count,
           COALESCE(SUM(subtotal), 0) as gross,
           COALESCE(SUM(total), 0) as net
         FROM orders
         WHERE created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)${clause}
         GROUP BY 1
         ORDER BY 1`,
        [range.from, range.to, ...filterParams]
      );

      return result.rows.map((row) => ({
        date: row.date as string,
        orderCount: parseInt(row.order_count, 10),
        gross: parseFloat(row.gross),
        net: parseFloat(row.net),
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
      // `name_snapshot`, not a join to `products`: the name as sold is what the
      // report is about, and a product renamed or deleted since must not change
      // or vanish from a period that has already been reported on. MIN() picks
      // one deterministically when a product was renamed mid-range.
      const { clause, params: filterParams, nextIndex } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           oi.product_id,
           MIN(oi.name_snapshot) as name,
           COALESCE(SUM(oi.quantity), 0) as quantity,
           COALESCE(SUM(oi.line_total), 0) as revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at >= to_timestamp($1 / 1000.0)
           AND o.created_at <= to_timestamp($2 / 1000.0)${clause}
         GROUP BY oi.product_id
         ORDER BY revenue DESC, quantity DESC
         LIMIT $${nextIndex}`,
        [range.from, range.to, ...filterParams, limit]
      );

      return result.rows.map((row) => ({
        productId: row.product_id as string,
        name: row.name as string,
        quantity: parseInt(row.quantity, 10),
        revenue: parseFloat(row.revenue),
      }));
    } catch (error) {
      logger.error('Error getting top products:', error);
      throw new DatabaseError('Failed to get top products');
    }
  }

  async getPaymentMix(range: ReportRange, filter?: RegisterFilter): Promise<PaymentMix[]> {
    try {
      // Two sources, deliberately. `payments` carries the split-tender breakdown
      // and is the truth for anything sold since it existed, but orders taken
      // before that migration have no rows there at all — reading only
      // `payments` would report a shop's entire history before the upgrade as
      // having been paid by nothing. Those orders fall back to their own
      // denormalised `payment_method`, and the NOT EXISTS keeps a split sale
      // from being counted twice.
      //
      // `$3`+ (the filter clause) is written once and referenced from both
      // UNION branches — a `$n` placeholder, unlike SQLite's `?`, can be
      // reused without repeating the value in the params array.
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
         FROM (
           SELECT LOWER(p.method) as method, p.amount as amount
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           WHERE o.created_at >= to_timestamp($1 / 1000.0)
             AND o.created_at <= to_timestamp($2 / 1000.0)${clause}
           UNION ALL
           SELECT LOWER(o.payment_method) as method, o.total as amount
           FROM orders o
           WHERE o.created_at >= to_timestamp($1 / 1000.0)
             AND o.created_at <= to_timestamp($2 / 1000.0)${clause}
             AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = o.id)
         ) mix
         GROUP BY method
         ORDER BY amount DESC, method`,
        [range.from, range.to, ...filterParams]
      );

      return result.rows.map((row) => ({
        method: row.method as string,
        count: parseInt(row.count, 10),
        amount: parseFloat(row.amount),
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
        'cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed') as return_count,
           COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0) as refunded,
           COUNT(*) FILTER (WHERE status IN ('pending', 'approved')) as pending_count,
           COALESCE(SUM(total) FILTER (WHERE status IN ('pending', 'approved')), 0) as pending_amount
         FROM returns
         WHERE created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)${clause}`,
        [range.from, range.to, ...filterParams]
      );

      const row = result.rows[0];
      return {
        returnCount: parseInt(row.return_count, 10),
        refunded: parseFloat(row.refunded),
        pendingCount: parseInt(row.pending_count, 10),
        pendingAmount: parseFloat(row.pending_amount),
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
        'cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           COALESCE(NULLIF(reason_code, ''), 'unspecified') as reason_code,
           COUNT(*) as return_count,
           COALESCE(SUM(total), 0) as refunded
         FROM returns
         WHERE status = 'completed'
           AND created_at >= to_timestamp($1 / 1000.0)
           AND created_at <= to_timestamp($2 / 1000.0)${clause}
         GROUP BY 1
         ORDER BY refunded DESC, reason_code`,
        [range.from, range.to, ...filterParams]
      );

      return result.rows.map((row) => ({
        reasonCode: row.reason_code as string,
        returnCount: parseInt(row.return_count, 10),
        refunded: parseFloat(row.refunded),
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
   * `JOIN orders o ON o.register_id = r.id AND o.created_at BETWEEN ...` puts
   * the range predicate in the join condition rather than the WHERE clause.
   * With an INNER JOIN the two are equivalent, but writing it this way makes
   * it obvious this is *not* a LEFT JOIN: a register that sold nothing in
   * range does not appear, and nothing here filters on `r.status`, so a
   * retired or disabled register that DID trade in range appears exactly like
   * an active one.
   */
  async getSalesByRegister(
    range: ReportRange,
    filter?: RegisterFilter
  ): Promise<SalesByRegister[]> {
    try {
      const {
        clause: orderClause,
        params: orderParams,
        nextIndex,
      } = this.registerFilterSQL(filter, 'o.register_id', 'o.cashier_user_id', 3);
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id',
        undefined,
        nextIndex
      );
      const result = await this.pool.query(
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
           COALESCE(SUM(o.subtotal), 0) as gross,
           COALESCE(SUM(o.discount_total), 0) as discounts,
           COALESCE(SUM(o.tax_total), 0) as tax,
           COALESCE(SUM(o.total), 0) as net
         FROM registers r
         JOIN locations l ON l.id = r.location_id
         JOIN orders o ON o.register_id = r.id
           AND o.created_at >= to_timestamp($1 / 1000.0)
           AND o.created_at <= to_timestamp($2 / 1000.0)${orderClause}
         WHERE 1=1${registerClause}
         GROUP BY r.id, r.display_code, r.name, r.location_id, l.name, r.type, r.has_cash_drawer, r.status
         ORDER BY l.name ASC, r.register_number ASC`,
        [range.from, range.to, ...orderParams, ...registerParams]
      );

      return result.rows.map((row) => ({
        registerId: row.register_id as string,
        displayCode: row.display_code as string,
        name: row.name as string,
        locationId: row.location_id as string,
        locationName: row.location_name as string,
        type: row.type as string,
        hasCashDrawer: Boolean(row.has_cash_drawer),
        status: row.status as string,
        orderCount: parseInt(row.order_count, 10),
        gross: parseFloat(row.gross),
        discounts: parseFloat(row.discounts),
        tax: parseFloat(row.tax),
        net: parseFloat(row.net),
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
   * `::text` on the COALESCE is required — `cashier_user_id` is `UUID`, and
   * `'unknown'` is not a valid literal of that type.
   */
  async getSalesByCashier(range: ReportRange, filter?: RegisterFilter): Promise<SalesByCashier[]> {
    try {
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'o.register_id',
        'o.cashier_user_id',
        3
      );
      const result = await this.pool.query(
        `SELECT
           COALESCE(o.cashier_user_id::text, 'unknown') as cashier_user_id,
           COALESCE(u.name, 'Unknown') as cashier_name,
           COUNT(*) as order_count,
           COALESCE(SUM(o.subtotal), 0) as gross,
           COALESCE(SUM(o.total), 0) as net
         FROM orders o
         LEFT JOIN users u ON u.id = o.cashier_user_id
         WHERE o.created_at >= to_timestamp($1 / 1000.0)
           AND o.created_at <= to_timestamp($2 / 1000.0)${clause}
         GROUP BY COALESCE(o.cashier_user_id::text, 'unknown'), COALESCE(u.name, 'Unknown')
         ORDER BY net DESC`,
        [range.from, range.to, ...filterParams]
      );

      return result.rows.map((row) => ({
        cashierUserId: row.cashier_user_id as string,
        cashierName: row.cashier_name as string,
        orderCount: parseInt(row.order_count, 10),
        gross: parseFloat(row.gross),
        net: parseFloat(row.net),
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
   * WHERE location_id = ANY(...))`), since `registerFilterSQL`'s `locationIds`
   * branch is always expressed as a subquery against `registers` regardless
   * of which register-identifying column it is applied to. Applying it again
   * against `l.id` directly would compare a location id to a set of register
   * ids — never equal, so it would silently zero out every result whenever
   * `registerIds` was the only filter in play. Found by the integration test
   * below.
   */
  async getSalesByLocation(range: ReportRange, filter?: RegisterFilter): Promise<SalesByLocation[]> {
    try {
      const {
        clause: orderClause,
        params: orderParams,
        nextIndex: afterOrder,
      } = this.registerFilterSQL(filter, 'o.register_id', 'o.cashier_user_id', 3);
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id',
        undefined,
        afterOrder
      );
      const result = await this.pool.query(
        `SELECT
           l.id as location_id,
           l.name as location_name,
           COUNT(DISTINCT o.register_id) as register_count,
           COUNT(o.id) as order_count,
           COALESCE(SUM(o.total), 0) as net
         FROM locations l
         JOIN registers r ON r.location_id = l.id
         JOIN orders o ON o.register_id = r.id
           AND o.created_at >= to_timestamp($1 / 1000.0)
           AND o.created_at <= to_timestamp($2 / 1000.0)${orderClause}
         WHERE 1=1${registerClause}
         GROUP BY l.id, l.name
         ORDER BY l.name ASC`,
        [range.from, range.to, ...orderParams, ...registerParams]
      );

      return result.rows.map((row) => ({
        locationId: row.location_id as string,
        locationName: row.location_name as string,
        registerCount: parseInt(row.register_count, 10),
        orderCount: parseInt(row.order_count, 10),
        net: parseFloat(row.net),
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
      const { clause, params: filterParams } = this.registerFilterSQL(
        filter,
        'r.id',
        undefined,
        3
      );
      const result = await this.pool.query(
        `SELECT
           r.id as register_id,
           r.display_code as display_code,
           r.name as name,
           COUNT(s.id) as session_count,
           COALESCE(SUM(s.variance), 0) as total_variance,
           COALESCE(MIN(s.variance), 0) as worst_variance,
           COUNT(*) FILTER (WHERE s.variance < 0) as short_count
         FROM registers r
         JOIN cash_drawer_sessions s ON s.register_id = r.id
           AND s.status = 'closed'
           AND s.closed_at >= to_timestamp($1 / 1000.0)
           AND s.closed_at <= to_timestamp($2 / 1000.0)
         WHERE 1=1${clause}
         GROUP BY r.id, r.display_code, r.name
         ORDER BY total_variance ASC`,
        [range.from, range.to, ...filterParams]
      );

      return result.rows.map((row) => ({
        registerId: row.register_id as string,
        displayCode: row.display_code as string,
        name: row.name as string,
        sessionCount: parseInt(row.session_count, 10),
        totalVariance: parseFloat(row.total_variance),
        worstVariance: parseFloat(row.worst_variance),
        shortCount: parseInt(row.short_count, 10),
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
      const {
        clause: overrideClause,
        params: overrideParams,
        nextIndex,
      } = this.registerFilterSQL(filter, 'o.register_id', 'o.requested_by_user_id', 3);
      const { clause: registerClause, params: registerParams } = this.registerFilterSQL(
        filter,
        'r.id',
        undefined,
        nextIndex
      );
      const result = await this.pool.query(
        `SELECT
           r.id as register_id,
           r.display_code as display_code,
           r.name as name,
           COUNT(o.id) as no_sale_count
         FROM registers r
         JOIN register_overrides o ON o.register_id = r.id
           AND o.action = 'no_sale'
           AND o.created_at >= to_timestamp($1 / 1000.0)
           AND o.created_at <= to_timestamp($2 / 1000.0)${overrideClause}
         WHERE 1=1${registerClause}
         GROUP BY r.id, r.display_code, r.name
         ORDER BY no_sale_count DESC`,
        [range.from, range.to, ...overrideParams, ...registerParams]
      );

      return result.rows.map((row) => ({
        registerId: row.register_id as string,
        displayCode: row.display_code as string,
        name: row.name as string,
        noSaleCount: parseInt(row.no_sale_count, 10),
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
   *
   * `created_at` is fetched as `EXTRACT(EPOCH FROM created_at) * 1000`,
   * **not** as the raw `TIMESTAMP` read into `new Date(string).getTime()`
   * the way other mappers in this file do. `orders.created_at` is `TIMESTAMP
   * WITHOUT TIME ZONE`, and node-postgres's default parser for that type
   * constructs the `Date` by reading the stored wall-clock digits as the
   * **Node process's own local timezone**, not UTC. Every other place in
   * this codebase that does `new Date(row.x).getTime()` happens to be
   * correct only because the process it runs in is set to UTC; this method
   * builds instants from those digits directly and then re-interprets them
   * in an *arbitrary* location timezone, so a wrong local offset here would
   * silently corrupt every hour it buckets. `EXTRACT(EPOCH FROM ...)`
   * computes the offset from Unix epoch treating the stored value as UTC —
   * the same convention `to_timestamp($n / 1000.0)` uses to write it —
   * making the round trip exact regardless of the server process's own
   * timezone. Caught by the integration test below failing under a non-UTC
   * `TZ`.
   */
  async getRegisterHourly(range: ReportRange, registerId: string): Promise<RegisterHourly[]> {
    try {
      const locationResult = await this.pool.query(
        `SELECT l.timezone as timezone
         FROM registers r
         JOIN locations l ON l.id = r.location_id
         WHERE r.id = $1`,
        [registerId]
      );

      const ordersResult = await this.pool.query(
        `SELECT EXTRACT(EPOCH FROM created_at) * 1000 as created_at_ms, total
         FROM orders
         WHERE register_id = $1
           AND created_at >= to_timestamp($2 / 1000.0)
           AND created_at <= to_timestamp($3 / 1000.0)`,
        [registerId, range.from, range.to]
      );

      const timezone = locationResult.rows[0]?.timezone
        ? (locationResult.rows[0].timezone as string)
        : 'UTC';

      return bucketOrdersByLocalHour(
        ordersResult.rows.map((row) => ({
          createdAt: Math.round(parseFloat(row.created_at_ms)),
          total: parseFloat(row.total),
        })),
        timezone
      );
    } catch (error) {
      logger.error('Error getting register hourly report:', error);
      throw new DatabaseError('Failed to get register hourly report');
    }
  }

  // ===== Terminal Transaction Operations =====
  /**
   * Record what we are about to charge, before charging it.
   *
   * Written outside any transaction and on purpose: this row's whole job is to
   * survive whatever happens next, including the request that created it dying
   * mid-authorisation. A row rolled back with its own failure would tell us
   * nothing about a card that was charged anyway.
   */
  async createPaymentAttempt(data: PaymentAttemptCreate): Promise<PaymentAttempt> {
    try {
      const result = await this.pool.query(
        `INSERT INTO payment_attempts
           (org_id, register_id, cashier_user_id, shift_id,
            amount_cents, currency, provider, cart_snapshot, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING *`,
        [
          data.orgId ?? null,
          data.registerId ?? null,
          data.cashierUserId ?? null,
          data.shiftId ?? null,
          data.amountCents,
          data.currency,
          data.provider,
          data.cartSnapshot === undefined ? null : JSON.stringify(data.cartSnapshot),
        ]
      );
      return mapPaymentAttempt(result.rows[0]);
    } catch (error) {
      logger.error('Error creating payment attempt:', error);
      throw new DatabaseError('Failed to record the payment attempt');
    }
  }

  async getPaymentAttemptById(id: string): Promise<PaymentAttempt | null> {
    try {
      const result = await this.pool.query('SELECT * FROM payment_attempts WHERE id = $1', [id]);
      return result.rows[0] ? mapPaymentAttempt(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error loading payment attempt:', error);
      throw new DatabaseError('Failed to load the payment attempt');
    }
  }

  /** Only the fields actually supplied, so a partial update cannot blank the rest. */
  async updatePaymentAttempt(id: string, patch: PaymentAttemptUpdate): Promise<PaymentAttempt | null> {
    const columns: Record<string, unknown> = {
      status: patch.status,
      charge_id: patch.chargeId,
      order_id: patch.orderId,
      failure_reason: patch.failureReason,
    };
    const present = Object.entries(columns).filter(([, value]) => value !== undefined);
    if (present.length === 0) return this.getPaymentAttemptById(id);

    try {
      const assignments = present.map(([column], index) => `${column} = $${index + 2}`);
      const result = await this.pool.query(
        `UPDATE payment_attempts
            SET ${assignments.join(', ')}, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, ...present.map(([, value]) => value)]
      );
      return result.rows[0] ? mapPaymentAttempt(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating payment attempt:', error);
      throw new DatabaseError('Failed to update the payment attempt');
    }
  }

  async createTerminalTransaction(data: TerminalTransactionCreate): Promise<{ id: string }> {
    try {
      const result = await this.pool.query(
        `INSERT INTO terminal_transactions
           (created_at, amount, currency, provider, charge_id, status, reader_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          data.startedAt,
          data.amount,
          data.currency,
          data.provider,
          data.chargeId,
          data.status,
          data.readerId ?? null,
        ]
      );
      return { id: result.rows[0].id };
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
      let idx = 1;

      if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
      if (updates.authCode !== undefined) { fields.push(`auth_code = $${idx++}`); values.push(updates.authCode); }
      if (updates.errorMessage !== undefined) { fields.push(`error_message = $${idx++}`); values.push(updates.errorMessage); }
      if (updates.orderId !== undefined) { fields.push(`order_id = $${idx++}`); values.push(updates.orderId); }
      if (updates.durationMs !== undefined) { fields.push(`duration_ms = $${idx++}`); values.push(updates.durationMs); }

      if (fields.length === 0) return;

      values.push(chargeId);
      await this.pool.query(
        `UPDATE terminal_transactions SET ${fields.join(', ')} WHERE charge_id = $${idx}`,
        values
      );
    } catch (error) {
      logger.error('Error updating terminal transaction:', error);
      throw new DatabaseError('Failed to update terminal transaction');
    }
  }

  // ===== Cash drawer sessions =====

  /** Scoped to one register: three tills can each have a session open at once. */
  async getOpenDrawerSession(registerId: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `SELECT s.*, o.name AS opened_by_name,
                r.name AS register_name, r.display_code AS register_display_code
         FROM cash_drawer_sessions s
         LEFT JOIN users o ON s.opened_by = o.id
         LEFT JOIN registers r ON s.register_id = r.id
         WHERE s.status = 'open' AND s.register_id = $1
         LIMIT 1`,
        [registerId]
      );
      return result.rows[0] ? mapDrawerSessionRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting open drawer session:', error);
      throw new DatabaseError('Failed to get drawer session');
    }
  }

  /**
   * Open a drawer.
   *
   * Relies on the per-register partial unique index for exclusivity rather
   * than checking first: two cashiers opening at once on the same register
   * would both pass a prior read, and then neither would know which drawer a
   * sale belonged to. `registerId` is required at the type level (an object
   * parameter, not a positional string) so a caller cannot omit it and land a
   * NULL - NULLs are distinct from one another in a Postgres unique index, so
   * a NULL `register_id` would not be constrained by that index at all.
   */
  async openDrawerSession(input: {
    registerId: string;
    openingFloat: number;
    userId?: string;
  }): Promise<DbRow> {
    try {
      const result = await this.pool.query(
        `INSERT INTO cash_drawer_sessions (register_id, opened_by, opening_float, status)
         VALUES ($1, $2, $3, 'open')
         RETURNING *`,
        [input.registerId, input.userId ?? null, input.openingFloat]
      );
      return mapDrawerSessionRow(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ValidationError(`Register ${input.registerId} already has a drawer session open`);
      }
      logger.error('Error opening drawer session:', error);
      throw new DatabaseError('Failed to open drawer session');
    }
  }

  /**
   * Cash the drawer should hold: the float, plus cash taken in, less change
   * given out, for sales rung while this session was open.
   *
   * Only cash sales count - a card sale never touches the drawer. Sales with no
   * recorded tender fall back to their total, which is what a cash sale
   * contributed before `amount_tendered` existed.
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
      const result = await this.pool.query(
        `SELECT
           s.opening_float
             + COALESCE(SUM(COALESCE(o.amount_tendered, o.total) - COALESCE(o.change_given, 0)), 0)
             AS expected
         FROM cash_drawer_sessions s
         LEFT JOIN orders o
           ON o.drawer_session_id = s.id
          AND LOWER(o.payment_method) = 'cash'
         WHERE s.id = $1
         GROUP BY s.opening_float`,
        [sessionId]
      );
      return result.rows[0] ? parseFloat(result.rows[0].expected) : 0;
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
      const result = await this.pool.query(
        `UPDATE cash_drawer_sessions
         SET status = 'closed',
             closed_at = NOW(),
             closed_by = $2,
             counted_cash = $3,
             expected_cash = $4,
             -- Cast explicitly: Postgres cannot infer the type of two untyped
             -- parameters being subtracted, and fails with "operator is not
             -- unique: unknown - unknown".
             variance = $3::numeric - $4::numeric,
             notes = $5
         WHERE id = $1 AND status = 'open'
         RETURNING *`,
        [sessionId, userId ?? null, countedCash, expectedCash, notes ?? null]
      );
      return result.rows[0] ? mapDrawerSessionRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error closing drawer session:', error);
      throw new DatabaseError('Failed to close drawer session');
    }
  }

  /** Unfiltered when `registerId` is omitted - the admin reconciliation view. */
  async getDrawerSessions(limit = 50, registerId?: string): Promise<DbRow[]> {
    try {
      const params: unknown[] = [];
      let whereClause = '';
      if (registerId) {
        params.push(registerId);
        whereClause = `WHERE s.register_id = $${params.length}`;
      }
      params.push(limit);

      const result = await this.pool.query(
        `SELECT s.*, o.name AS opened_by_name, c.name AS closed_by_name,
                r.name AS register_name, r.display_code AS register_display_code
         FROM cash_drawer_sessions s
         LEFT JOIN users o ON s.opened_by = o.id
         LEFT JOIN users c ON s.closed_by = c.id
         LEFT JOIN registers r ON s.register_id = r.id
         ${whereClause}
         ORDER BY s.opened_at DESC
         LIMIT $${params.length}`,
        params
      );
      return result.rows.map(mapDrawerSessionRow);
    } catch (error) {
      logger.error('Error listing drawer sessions:', error);
      throw new DatabaseError('Failed to list drawer sessions');
    }
  }


  // ===== Product variants =====

  /**
   * Add a variant to an existing product.
   *
   * There was no way to do this: `createProduct` takes nested variants, but
   * `updateProduct` takes none, so a product's options were fixed at creation.
   * CSV re-import could not update stock on anything already in the catalog,
   * which is the ordinary case for a shop restocking.
   */
  async createVariant(productId: string, variant: Record<string, unknown>): Promise<DbRow | null> {
    try {
      const product = await this.pool.query('SELECT id FROM products WHERE id = $1', [productId]);
      if (product.rows.length === 0) return null;

      const result = await this.pool.query(
        `INSERT INTO product_variants
         (product_id, size, color, price_override, price_delta, sku, barcode, stock, enabled,
          low_stock_threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          productId,
          variant.size ?? null,
          variant.color ?? null,
          variant.priceOverride ?? null,
          variant.priceDelta ?? null,
          variant.sku ?? null,
          variant.barcode ?? null,
          variant.stock ?? 0,
          variant.enabled !== false,
          variant.lowStockThreshold ?? null,
        ]
      );
      return mapVariantRow(result.rows[0]);
    } catch (error) {
      logger.error('Error creating variant:', error);
      throw new DatabaseError('Failed to create variant');
    }
  }

  /**
   * Update a variant.
   *
   * COALESCE throughout, for the same reason as `updateProduct`: every field is
   * optional, and writing the parameters straight through would blank whatever
   * the caller did not mention. `enabled` is handled separately because it is a
   * boolean where `false` is a real value, not an absence.
   */
  async updateVariant(
    productId: string,
    variantId: string,
    variant: Record<string, unknown>
  ): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `UPDATE product_variants
         SET size = COALESCE($3, size),
             color = COALESCE($4, color),
             price_override = COALESCE($5, price_override),
             price_delta = COALESCE($6, price_delta),
             sku = COALESCE($7, sku),
             barcode = COALESCE($8, barcode),
             stock = COALESCE($9, stock),
             enabled = COALESCE($10, enabled),
             -- Explicit null means "go back to the store default", which
             -- COALESCE alone cannot express: it reads every null as "not
             -- mentioned", so a threshold once set could never be cleared.
             low_stock_threshold = CASE
               WHEN $12::boolean THEN NULL
               ELSE COALESCE($11, low_stock_threshold)
             END
         WHERE id = $1 AND product_id = $2
         RETURNING *`,
        [
          variantId,
          productId,
          variant.size ?? null,
          variant.color ?? null,
          variant.priceOverride ?? null,
          variant.priceDelta ?? null,
          variant.sku ?? null,
          variant.barcode ?? null,
          variant.stock ?? null,
          variant.enabled ?? null,
          variant.lowStockThreshold ?? null,
          'lowStockThreshold' in variant && variant.lowStockThreshold === null,
        ]
      );
      return result.rows[0] ? mapVariantRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating variant:', error);
      throw new DatabaseError('Failed to update variant');
    }
  }

  // ===== Categories =====
  //
  // `products.category` holds the category *name*, not a foreign key. That is
  // how the schema already was, and converting it would mean backfilling every
  // product whose category was typed rather than picked, plus rewriting the
  // catalog filter, the CSV import, and the exports. The cost is that the two
  // have to be kept in step by hand — which is what `renameCategory` is for.

  async getAllCategories(): Promise<DbRow[]> {
    try {
      // The product count comes back with the row because every caller wants it:
      // the admin list shows it, and delete needs it to explain a refusal.
      const result = await this.pool.query(
        `SELECT c.id, c.name, c.icon, COUNT(p.id)::int AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category = c.name
         GROUP BY c.id, c.name, c.icon
         ORDER BY c.name ASC`
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        productCount: row.product_count,
      }));
    } catch (error) {
      logger.error('Error getting categories:', error);
      throw new DatabaseError('Failed to get categories');
    }
  }

  /**
   * Category names that products use but no category row defines.
   *
   * `products.category` is free text historically, so a typo or an import could
   * put a product in a category the manager cannot see — and therefore cannot
   * rename, merge, or clean up. Surfacing them is what makes "products
   * reference valid categories" something a shop can actually act on.
   */
  async getUnmanagedCategories(): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT p.category AS name, COUNT(*)::int AS product_count
         FROM products p
         LEFT JOIN categories c ON c.name = p.category
         WHERE c.id IS NULL AND p.category IS NOT NULL AND p.category <> ''
         GROUP BY p.category
         ORDER BY p.category ASC`
      );
      return result.rows.map((row) => ({ name: row.name, productCount: row.product_count }));
    } catch (error) {
      logger.error('Error getting unmanaged categories:', error);
      throw new DatabaseError('Failed to get categories');
    }
  }

  /** Null when the name is already taken, which the route turns into a 409. */
  async createCategory(name: string, icon: string | null): Promise<DbRow | null> {
    try {
      // Case-insensitive: "drinks" alongside "Drinks" is a typo, not two
      // categories, and the products under each would never appear together.
      const clash = await this.pool.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [
        name,
      ]);
      if (clash.rows.length > 0) return null;

      const result = await this.pool.query(
        'INSERT INTO categories (name, icon) VALUES ($1, $2) RETURNING id, name, icon',
        [name, icon]
      );
      return { ...result.rows[0], productCount: 0 };
    } catch (error) {
      logger.error('Error creating category:', error);
      throw new DatabaseError('Failed to create category');
    }
  }

  /**
   * Rename a category, carrying its products with it.
   *
   * Because `products.category` stores the name, renaming the row alone would
   * leave every product pointing at a category that no longer exists — they
   * would vanish from the category filter while still claiming to be in it. The
   * two writes are one transaction so a failure cannot leave that state behind.
   */
  async renameCategory(
    id: string,
    name: string,
    icon: string | null | undefined
  ): Promise<DbRow | null | 'duplicate'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT name FROM categories WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const clash = await client.query(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id <> $2',
        [name, id]
      );
      if (clash.rows.length > 0) {
        await client.query('ROLLBACK');
        return 'duplicate';
      }

      const previousName = existing.rows[0].name;
      const result = await client.query(
        'UPDATE categories SET name = $2, icon = COALESCE($3, icon) WHERE id = $1 RETURNING id, name, icon',
        [id, name, icon ?? null]
      );

      const moved = await client.query('UPDATE products SET category = $1 WHERE category = $2', [
        name,
        previousName,
      ]);

      await client.query('COMMIT');
      return { ...result.rows[0], productCount: moved.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error renaming category:', error);
      throw new DatabaseError('Failed to rename category');
    } finally {
      client.release();
    }
  }

  /**
   * Delete a category, optionally moving its products somewhere else first.
   *
   * Without `reassignTo` an in-use category is refused rather than deleted:
   * `products.category` is NOT NULL, so the products would be left naming a
   * category that no longer exists and would disappear from the filter.
   */
  async deleteCategory(
    id: string,
    reassignTo?: string
  ): Promise<'deleted' | 'not_found' | { inUse: number } | 'bad_target'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT name FROM categories WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const name = existing.rows[0].name;

      const inUse = await client.query(
        'SELECT COUNT(*)::int AS count FROM products WHERE category = $1',
        [name]
      );
      const count = inUse.rows[0].count;

      if (count > 0) {
        if (!reassignTo) {
          await client.query('ROLLBACK');
          return { inUse: count };
        }

        // The destination has to be a real category, or reassignment would
        // strand the products just as thoroughly as deleting outright.
        const target = await client.query(
          'SELECT name FROM categories WHERE LOWER(name) = LOWER($1) AND id <> $2',
          [reassignTo, id]
        );
        if (target.rows.length === 0) {
          await client.query('ROLLBACK');
          return 'bad_target';
        }

        await client.query('UPDATE products SET category = $1 WHERE category = $2', [
          target.rows[0].name,
          name,
        ]);
      }

      await client.query('DELETE FROM categories WHERE id = $1', [id]);
      await client.query('COMMIT');
      return 'deleted';
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting category:', error);
      throw new DatabaseError('Failed to delete category');
    } finally {
      client.release();
    }
  }

  /**
   * Variants at or below their low-stock threshold.
   *
   * The threshold is per-variant, falling back to the store default, because a
   * shop can be out of Large while Small is fine — and because what counts as
   * low differs by item: two wedding cakes is a lot, two rolls of receipt paper
   * is nearly none.
   *
   * Disabled variants are excluded. They are not for sale, so they cannot run
   * out, and including them would bury the real shortages under discontinued
   * ones.
   *
   * Ordered by how far under the threshold each one is, so the most urgent
   * comes first rather than whatever happens to sort first alphabetically.
   */
  async getLowStockVariants(defaultThreshold: number): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT v.*, p.id AS product_id, p.name AS product_name, p.category
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.enabled = true
           AND v.stock <= COALESCE(v.low_stock_threshold, $1)
         ORDER BY v.stock - COALESCE(v.low_stock_threshold, $1) ASC, p.name ASC`,
        [defaultThreshold]
      );

      return result.rows.map((row) => ({
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

  /**
   * Remove a variant.
   *
   * Refuses the last one: a product with no variants cannot be sold, and the
   * catalog has no separate notion of "unsellable". Disable it instead.
   */
  async deleteVariant(productId: string, variantId: string): Promise<'deleted' | 'not_found' | 'last'> {
    try {
      const remaining = await this.pool.query(
        'SELECT COUNT(*)::int AS count FROM product_variants WHERE product_id = $1',
        [productId]
      );
      if (remaining.rows[0].count <= 1) {
        const exists = await this.pool.query(
          'SELECT id FROM product_variants WHERE id = $1 AND product_id = $2',
          [variantId, productId]
        );
        return exists.rows.length > 0 ? 'last' : 'not_found';
      }

      const result = await this.pool.query(
        'DELETE FROM product_variants WHERE id = $1 AND product_id = $2',
        [variantId, productId]
      );
      return (result.rowCount ?? 0) > 0 ? 'deleted' : 'not_found';
    } catch (error) {
      logger.error('Error deleting variant:', error);
      throw new DatabaseError('Failed to delete variant');
    }
  }

  // Location Operations

  /** Active locations first, then alphabetical. Each row carries a count of its non-retired registers. */
  async getLocations(orgId: string): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        `SELECT l.*,
                (SELECT COUNT(*) FROM registers r
                 WHERE r.location_id = l.id AND r.status <> 'retired') AS register_count
         FROM locations l
         WHERE l.org_id = $1
         ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.name ASC`,
        [orgId]
      );
      return result.rows.map((row) => ({ ...mapLocation(row), registerCount: Number(row.register_count) }));
    } catch (error) {
      logger.error('Error getting locations:', error);
      throw new DatabaseError('Failed to get locations');
    }
  }

  async getLocationById(id: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query('SELECT * FROM locations WHERE id = $1', [id]);
      return result.rows.length > 0 ? mapLocation(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting location by id:', error);
      throw new DatabaseError('Failed to get location');
    }
  }

  async createLocation(payload: Record<string, unknown>): Promise<DbRow | 'duplicate_slug'> {
    try {
      const orgId = String(payload.org_id);
      const slug = String(payload.slug);

      const clash = await this.pool.query(
        'SELECT id FROM locations WHERE org_id = $1 AND slug = $2',
        [orgId, slug]
      );
      if (clash.rows.length > 0) return 'duplicate_slug';

      const result = await this.pool.query(
        `INSERT INTO locations (org_id, name, slug, address, city, state, zip, timezone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          orgId,
          String(payload.name),
          slug,
          (payload.address as string | undefined) ?? null,
          (payload.city as string | undefined) ?? null,
          (payload.state as string | undefined) ?? null,
          (payload.zip as string | undefined) ?? null,
          (payload.timezone as string | undefined) ?? 'UTC',
          (payload.status as string | undefined) ?? 'active',
        ]
      );
      return mapLocation(result.rows[0]);
    } catch (error) {
      logger.error('Error creating location:', error);
      throw new DatabaseError('Failed to create location');
    }
  }

  /**
   * Partial update, built as a dynamic SET clause rather than COALESCE.
   *
   * COALESCE($n, column) cannot tell "the caller sent null to clear this
   * field" apart from "the caller didn't send this field at all" — both
   * arrive as a bound NULL. That collapses the two into one behavior (keep
   * the existing value), which makes it impossible to ever clear a
   * nullable column such as `address`. So presence is checked with
   * `hasOwnProperty` before a column is included in the update at all;
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
      const existing = await this.pool.query('SELECT * FROM locations WHERE id = $1', [id]);
      if (existing.rows.length === 0) return null;
      const current = existing.rows[0];

      const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);

      if (has('slug') && payload.slug != null) {
        const slug = payload.slug as string;
        if (slug !== current.slug) {
          const clash = await this.pool.query(
            'SELECT id FROM locations WHERE org_id = $1 AND slug = $2 AND id <> $3',
            [current.org_id, slug, id]
          );
          if (clash.rows.length > 0) return 'duplicate_slug';
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        sets.push(`${column} = $${values.length + 1}`);
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
        return mapLocation(current);
      }

      sets.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      const idPlaceholder = `$${values.length}`;

      const result = await this.pool.query(
        `UPDATE locations SET ${sets.join(', ')} WHERE id = ${idPlaceholder} RETURNING *`,
        values
      );
      return mapLocation(result.rows[0]);
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
        WHERE r.org_id = $1
      `;
      const params: unknown[] = [filter.orgId];
      let paramIndex = 2;

      if (filter.locationId) {
        query += ` AND r.location_id = $${paramIndex++}`;
        params.push(filter.locationId);
      }
      if (filter.status) {
        query += ` AND r.status = $${paramIndex++}`;
        params.push(filter.status);
      }

      query += ' ORDER BY l.name ASC, r.register_number ASC';

      const result = await this.pool.query(query, params);
      return result.rows.map((row) => ({ ...mapRegister(row), locationName: row.location_name }));
    } catch (error) {
      logger.error('Error getting registers:', error);
      throw new DatabaseError('Failed to get registers');
    }
  }

  async getRegisterById(id: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `SELECT r.*, l.name AS location_name
         FROM registers r
         JOIN locations l ON l.id = r.location_id
         WHERE r.id = $1`,
        [id]
      );
      if (result.rows.length === 0) return null;
      return { ...mapRegister(result.rows[0]), locationName: result.rows[0].location_name };
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

      const location = await this.pool.query('SELECT org_id FROM locations WHERE id = $1', [locationId]);
      if (location.rows.length === 0 || String(location.rows[0].org_id) !== orgId) {
        return 'bad_location';
      }

      const numberClash = await this.pool.query(
        'SELECT id FROM registers WHERE location_id = $1 AND register_number = $2',
        [locationId, registerNumber]
      );
      if (numberClash.rows.length > 0) return 'duplicate_number';

      const codeClash = await this.pool.query(
        'SELECT id FROM registers WHERE org_id = $1 AND display_code = $2',
        [orgId, displayCode]
      );
      if (codeClash.rows.length > 0) return 'duplicate_code';

      const result = await this.pool.query(
        `INSERT INTO registers
          (org_id, location_id, name, register_number, display_code, placement, type,
           has_cash_drawer, accepts_cash, can_refund, can_open_drawer_no_sale, require_sign_in,
           idle_lock_seconds, terminal_provider, terminal_device_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          orgId,
          locationId,
          String(payload.name),
          registerNumber,
          displayCode,
          (payload.placement as string | undefined) ?? null,
          (payload.type as string | undefined) ?? 'fixed',
          payload.has_cash_drawer !== false,
          payload.accepts_cash !== false,
          payload.can_refund !== false,
          Boolean(payload.can_open_drawer_no_sale),
          Boolean(payload.require_sign_in),
          (payload.idle_lock_seconds as number | undefined) ?? 300,
          (payload.terminal_provider as string | undefined) ?? null,
          (payload.terminal_device_id as string | undefined) ?? null,
          (payload.status as string | undefined) ?? 'pending',
          (payload.created_by as string | undefined) ?? null,
        ]
      );
      return mapRegister(result.rows[0]);
    } catch (error) {
      logger.error('Error creating register:', error);
      throw new DatabaseError('Failed to create register');
    }
  }

  /**
   * Partial update, built as a dynamic SET clause rather than COALESCE —
   * see the comment on `updateLocation` for why. `terminal_provider` and
   * `terminal_device_id` are the case this exists for: unbinding a dead
   * card reader means sending `terminalProvider: null` and having it
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
      const existing = await this.pool.query('SELECT * FROM registers WHERE id = $1', [id]);
      if (existing.rows.length === 0) return null;
      const current = existing.rows[0];

      const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);

      if (has('display_code') && payload.display_code != null) {
        const displayCode = payload.display_code as string;
        if (displayCode !== current.display_code) {
          const clash = await this.pool.query(
            'SELECT id FROM registers WHERE org_id = $1 AND display_code = $2 AND id <> $3',
            [current.org_id, displayCode, id]
          );
          if (clash.rows.length > 0) return 'duplicate_code';
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        sets.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };

      // NOT NULL columns: skip rather than write an explicit null.
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
        assign('has_cash_drawer', Boolean(payload.has_cash_drawer));
      }
      if (has('accepts_cash') && payload.accepts_cash != null) {
        assign('accepts_cash', Boolean(payload.accepts_cash));
      }
      if (has('can_refund') && payload.can_refund != null) {
        assign('can_refund', Boolean(payload.can_refund));
      }
      if (has('can_open_drawer_no_sale') && payload.can_open_drawer_no_sale != null) {
        assign('can_open_drawer_no_sale', Boolean(payload.can_open_drawer_no_sale));
      }
      if (has('require_sign_in') && payload.require_sign_in != null) {
        assign('require_sign_in', Boolean(payload.require_sign_in));
      }

      // Nullable columns: an explicit null clears them.
      if (has('placement')) assign('placement', payload.placement ?? null);
      if (has('terminal_provider')) assign('terminal_provider', payload.terminal_provider ?? null);
      if (has('terminal_device_id')) {
        assign('terminal_device_id', payload.terminal_device_id ?? null);
      }

      if (sets.length === 0) {
        return mapRegister(current);
      }

      sets.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      const idPlaceholder = `$${values.length}`;

      const result = await this.pool.query(
        `UPDATE registers SET ${sets.join(', ')} WHERE id = ${idPlaceholder} RETURNING *`,
        values
      );
      return mapRegister(result.rows[0]);
    } catch (error) {
      logger.error('Error updating register:', error);
      throw new DatabaseError('Failed to update register');
    }
  }

  async setRegisterStatus(id: string, status: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        'UPDATE registers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [status, id]
      );
      return result.rows.length > 0 ? mapRegister(result.rows[0]) : null;
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
      const result = await this.pool.query(
        `SELECT COUNT(*)::int AS count FROM registers
         WHERE org_id = $1 AND status IN ('pending', 'active', 'disabled')`,
        [orgId]
      );
      return Number(result.rows[0].count);
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
      const result = await this.pool.query(
        'SELECT register_number FROM registers WHERE location_id = $1 ORDER BY register_number ASC',
        [locationId]
      );
      return result.rows.map((row) => Number(row.register_number));
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
      const result = await this.pool.query(
        'SELECT max_registers, pin_length FROM organizations WHERE id = $1',
        [orgId]
      );
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
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
      const result = await this.pool.query(
        'SELECT drawer_variance_threshold FROM organizations WHERE id = $1',
        [orgId]
      );
      if (result.rows.length === 0) return null;

      const value = result.rows[0].drawer_variance_threshold;
      return value == null ? null : Number(value);
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
      const result = await this.pool.query(
        `SELECT * FROM register_credentials
         WHERE register_id = $1 AND revoked_at IS NULL AND token_hash IS NULL
         LIMIT 1`,
        [registerId]
      );
      return result.rows[0] ? mapRegisterCredential(result.rows[0]) : null;
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
      const result = await this.pool.query(
        `SELECT * FROM register_credentials
         WHERE register_id = $1 AND revoked_at IS NULL AND token_hash IS NOT NULL
         LIMIT 1`,
        [registerId]
      );
      return result.rows[0] ? mapRegisterCredential(result.rows[0]) : null;
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
      const result = await this.pool.query(
        'SELECT * FROM register_credentials WHERE register_id = $1 AND revoked_at IS NULL',
        [registerId]
      );
      return result.rows.map(mapRegisterCredential);
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
      const result = await this.pool.query(
        `INSERT INTO register_credentials
          (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          payload.registerId,
          payload.pairingCodePrefix,
          payload.pairingCodeHash,
          new Date(payload.pairingExpiresAt),
          payload.createdBy,
        ]
      );
      return mapRegisterCredential(result.rows[0]);
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
      const result = await this.pool.query(
        'SELECT * FROM register_credentials WHERE pairing_code_prefix = $1',
        [prefix]
      );
      return result.rows.map(mapRegisterCredential);
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
      const result = await this.pool.query(
        `UPDATE register_credentials
         SET token_prefix = $2, token_hash = $3, enrolled_at = $4
         WHERE id = $1 AND enrolled_at IS NULL AND revoked_at IS NULL
         RETURNING *`,
        [id, payload.tokenPrefix, payload.tokenHash, new Date(payload.enrolledAt)]
      );
      return result.rows[0] ? mapRegisterCredential(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error redeeming pairing credential:', error);
      throw new DatabaseError('Failed to redeem pairing credential');
    }
  }

  /** Every row sharing a device-token prefix, revoked or not — see the pairing-code equivalent above. */
  async getRegisterCredentialsByTokenPrefix(prefix: string): Promise<DbRow[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM register_credentials WHERE token_prefix = $1',
        [prefix]
      );
      return result.rows.map(mapRegisterCredential);
    } catch (error) {
      logger.error('Error getting register credentials by token prefix:', error);
      throw new DatabaseError('Failed to get register credentials');
    }
  }

  /** Best-effort: a failure to stamp last-used must not fail the request it describes. */
  async touchRegisterCredentialLastUsed(id: string): Promise<void> {
    try {
      await this.pool.query('UPDATE register_credentials SET last_used_at = NOW() WHERE id = $1', [id]);
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
      const result = await this.pool.query(
        `UPDATE register_credentials
         SET revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING *`,
        [id, payload.revokedBy, payload.reason]
      );
      return result.rows[0] ? mapRegisterCredential(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error revoking register credential:', error);
      throw new DatabaseError('Failed to revoke register credential');
    }
  }

  /** Cheap by design — called on every device heartbeat, roughly once a minute per till. */
  async touchRegisterLastSeen(registerId: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `UPDATE registers SET last_seen_at = NOW(), updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [registerId]
      );
      return result.rows[0] ? mapRegister(result.rows[0]) : null;
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
      const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return result.rows[0] ? mapUserPin(result.rows[0]) : null;
    } catch (error) {
      if (isInvalidTextRepresentation(error)) return null;
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
      const result = await this.pool.query(
        `SELECT * FROM users
         WHERE status = 'active' AND pin_hash IS NOT NULL
           AND COALESCE(org_id, $1) = $2`,
        [DEFAULT_ORG_ID, orgId]
      );
      return result.rows.map(mapUserPin);
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
      const result = await this.pool.query(
        `SELECT * FROM users
         WHERE status = 'active' AND pin_hash IS NOT NULL AND can_override = true
           AND COALESCE(org_id, $1) = $2`,
        [DEFAULT_ORG_ID, orgId]
      );
      return result.rows.map(mapUserPin);
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
      const result = await this.pool.query(
        `UPDATE users
         SET pin_hash = $2, pin_set_at = $3, pin_failed_count = 0, pin_locked_until = NULL
         WHERE id = $1
         RETURNING id, email, name, status, pin_set_at`,
        // null clears the PIN; Date(null) would be epoch 0, which reads as a
        // PIN set in 1970 rather than as no PIN at all.
        [userId, payload.pinHash, payload.pinSetAt === null ? null : new Date(payload.pinSetAt)]
      );
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: String(row.id),
        email: row.email,
        name: row.name,
        status: row.status,
        pinSetAt: row.pin_set_at == null ? null : new Date(row.pin_set_at as string).getTime(),
      };
    } catch (error) {
      if (isInvalidTextRepresentation(error)) return null;
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
      await this.pool.query('UPDATE users SET pin_failed_count = $2, pin_locked_until = $3 WHERE id = $1', [
        userId,
        payload.failedCount,
        payload.lockedUntil == null ? null : new Date(payload.lockedUntil),
      ]);
    } catch (error) {
      logger.error('Error recording PIN failure:', error);
      throw new DatabaseError('Failed to record PIN failure');
    }
  }

  /** A successful verify resets the counter and clears any lock. */
  async resetPinFailures(userId: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE users SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = $1',
        [userId]
      );
    } catch (error) {
      logger.error('Error resetting PIN failures:', error);
      throw new DatabaseError('Failed to reset PIN failures');
    }
  }

  // Register shifts (migration 018)

  /** The register's currently open shift, if it has one — see migration 018's partial unique index. */
  async getOpenShiftForRegister(registerId: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM register_shifts WHERE register_id = $1 AND ended_at IS NULL LIMIT 1',
        [registerId]
      );
      return result.rows[0] ? mapRegisterShift(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting open register shift:', error);
      throw new DatabaseError('Failed to get open shift');
    }
  }

  /**
   * One shift by id, open or closed.
   *
   * `getOpenShiftForRegister` answers "who is on this till"; session validation
   * asks the different question "is this specific shift still open", and must
   * see a closed row rather than null so it can tell "ended" from "never
   * existed".
   */
  async getRegisterShiftById(shiftId: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query('SELECT * FROM register_shifts WHERE id = $1', [shiftId]);
      return result.rows[0] ? mapRegisterShift(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting register shift by id:', error);
      throw new DatabaseError('Failed to get register shift');
    }
  }

  /**
   * Open a shift. Callers are expected to have already ended any prior open
   * shift on this register (`services/registerShifts.ts` does, marking it
   * `superseded`) — this does not check, and relies on migration 018's
   * partial unique index to reject a genuine race rather than silently
   * allowing two open shifts on one register.
   */
  async createRegisterShift(payload: {
    registerId: string;
    userId: string;
    /** See migration 020 and `mapRegisterShift` — recorded, never attributed. */
    emulatedUserId?: string;
  }): Promise<DbRow> {
    try {
      const result = await this.pool.query(
        `INSERT INTO register_shifts (register_id, user_id, emulated_user_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [payload.registerId, payload.userId, payload.emulatedUserId ?? null]
      );
      return mapRegisterShift(result.rows[0]);
    } catch (error) {
      logger.error('Error creating register shift:', error);
      throw new DatabaseError('Failed to start shift');
    }
  }

  /** Guarded on `ended_at IS NULL` so ending an already-ended shift twice is a no-op, not a second event. */
  async endRegisterShift(shiftId: string, reason: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `UPDATE register_shifts SET ended_at = NOW(), end_reason = $2
         WHERE id = $1 AND ended_at IS NULL
         RETURNING *`,
        [shiftId, reason]
      );
      return result.rows[0] ? mapRegisterShift(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error ending register shift:', error);
      throw new DatabaseError('Failed to end shift');
    }
  }

  /** Bump a shift's idle clock. Guarded on `ended_at IS NULL` so a stale client cannot revive an ended shift. */
  async touchRegisterShiftActivity(shiftId: string): Promise<DbRow | null> {
    try {
      const result = await this.pool.query(
        `UPDATE register_shifts SET last_activity_at = NOW()
         WHERE id = $1 AND ended_at IS NULL
         RETURNING *`,
        [shiftId]
      );
      return result.rows[0] ? mapRegisterShift(result.rows[0]) : null;
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
      const result = await this.pool.query(
        `INSERT INTO register_overrides
          (register_id, shift_id, approver_user_id, requested_by_user_id, action,
           grant_prefix, grant_hash, expires_at, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          payload.registerId,
          payload.shiftId,
          payload.approverUserId,
          payload.requestedByUserId,
          payload.action,
          payload.grantPrefix,
          payload.grantHash,
          new Date(payload.expiresAt),
          payload.reason,
        ]
      );
      return mapRegisterOverride(result.rows[0]);
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
      const result = await this.pool.query(
        'SELECT * FROM register_overrides WHERE grant_prefix = $1',
        [prefix]
      );
      return result.rows.map(mapRegisterOverride);
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
      const result = await this.pool.query(
        `UPDATE register_overrides
         SET consumed_at = NOW(), entity = $2, entity_id = $3, before_value = $4, after_value = $5
         WHERE id = $1 AND consumed_at IS NULL
         RETURNING *`,
        [id, payload.entity, payload.entityId, payload.beforeValue, payload.afterValue]
      );
      return result.rows[0] ? mapRegisterOverride(result.rows[0]) : null;
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
      const conditions = ['r.org_id = $1'];
      const params: unknown[] = [filter.orgId];
      if (filter.registerId) {
        params.push(filter.registerId);
        conditions.push(`o.register_id = $${params.length}`);
      }
      if (filter.approverUserId) {
        params.push(filter.approverUserId);
        conditions.push(`o.approver_user_id = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await this.pool.query(
        `SELECT COUNT(*) AS count FROM register_overrides o
         JOIN registers r ON r.id = o.register_id
         WHERE ${where}`,
        params
      );

      const limitParamIndex = params.length + 1;
      const offsetParamIndex = params.length + 2;
      const rowsResult = await this.pool.query(
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
         LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
        [...params, filter.limit, filter.offset]
      );

      return {
        overrides: rowsResult.rows.map(mapRegisterOverrideSummary),
        total: Number(countResult.rows[0].count),
      };
    } catch (error) {
      logger.error('Error getting register overrides:', error);
      throw new DatabaseError('Failed to get override log');
    }
  }

  /**
   * The shift log: who stood at which till, when, and how the shift ended.
   *
   * `register_shifts` had no list query before this — every other method
   * fetches exactly one shift, because that is all a till needs. Nothing could
   * answer "who was on this register on Tuesday", which is the question the
   * table exists to answer and the reason a shift is recorded at all.
   *
   * Scoped to `orgId` through a join on `registers`, since `register_shifts`
   * carries no `org_id` of its own — the same route `getRegisterOverrides`
   * takes, and for the same reason: without it, a bare register id from
   * another shop would read that shop's roster.
   *
   * Ordered by `started_at DESC`, tie-broken on `id` so a page boundary cannot
   * show the same row twice when two shifts share a timestamp.
   */
  async getRegisterShifts(filter: {
    orgId: string;
    limit: number;
    offset: number;
    registerId?: string;
    locationId?: string;
    userId?: string;
    openOnly?: boolean;
    from?: number;
    to?: number;
  }): Promise<{ shifts: DbRow[]; total: number }> {
    try {
      const conditions = ['r.org_id = $1'];
      const params: unknown[] = [filter.orgId];

      if (filter.registerId) {
        params.push(filter.registerId);
        conditions.push(`s.register_id = $${params.length}`);
      }
      if (filter.locationId) {
        params.push(filter.locationId);
        conditions.push(`r.location_id = $${params.length}`);
      }
      if (filter.userId) {
        params.push(filter.userId);
        conditions.push(`s.user_id = $${params.length}`);
      }
      if (filter.openOnly) {
        conditions.push('s.ended_at IS NULL');
      }
      if (filter.from !== undefined) {
        params.push(filter.from);
        conditions.push(`s.started_at >= to_timestamp($${params.length} / 1000.0)`);
      }
      if (filter.to !== undefined) {
        params.push(filter.to);
        conditions.push(`s.started_at <= to_timestamp($${params.length} / 1000.0)`);
      }

      const where = conditions.join(' AND ');

      const countResult = await this.pool.query(
        `SELECT COUNT(*) AS count FROM register_shifts s
         JOIN registers r ON r.id = s.register_id
         WHERE ${where}`,
        params
      );

      const rowsResult = await this.pool.query(
        `SELECT s.*,
                u.name AS cashier_name,
                u.email AS cashier_email,
                e.name AS emulated_user_name,
                r.name AS register_name,
                r.display_code AS register_display_code,
                l.name AS location_name
         FROM register_shifts s
         JOIN registers r ON r.id = s.register_id
         LEFT JOIN locations l ON l.id = r.location_id
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN users e ON e.id = s.emulated_user_id
         WHERE ${where}
         ORDER BY s.started_at DESC, s.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, filter.limit, filter.offset]
      );

      return {
        shifts: rowsResult.rows.map(mapRegisterShiftSummary),
        total: Number(countResult.rows[0].count),
      };
    } catch (error) {
      logger.error('Error getting register shifts:', error);
      throw new DatabaseError('Failed to get the shift log');
    }
  }

}

/**
 * A payment_attempts row in the shape the application uses.
 *
 * `cart_snapshot` comes back parsed from JSONB on Postgres but as text on
 * SQLite, so both adapters funnel through the same tolerant read.
 */
function mapPaymentAttempt(row: DbRow): PaymentAttempt {
  return {
    id: String(row.id),
    orgId: row.org_id ?? null,
    registerId: row.register_id ?? null,
    cashierUserId: row.cashier_user_id ?? null,
    shiftId: row.shift_id ?? null,
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    provider: String(row.provider),
    chargeId: row.charge_id ?? null,
    status: row.status,
    failureReason: row.failure_reason ?? null,
    orderId: row.order_id ?? null,
    cartSnapshot: parseCartSnapshot(row.cart_snapshot),
    createdAt: toEpochMillis(row.created_at),
    updatedAt: toEpochMillis(row.updated_at),
  };
}

function parseCartSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    // A snapshot we cannot read is a reporting inconvenience, never a reason to
    // fail the lookup that someone is using to reconcile a real charge.
    return null;
  }
}

function toEpochMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return Number(value);
}
