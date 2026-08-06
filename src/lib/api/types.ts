/**
 * Shared DTO types — the single source of truth for the shapes the REST API
 * exchanges with this client.
 *
 * These describe the *unwrapped* payloads. `api-client` consumes the
 * `{success, data}` envelope, so nothing here models it.
 *
 * **Money.** Every amount is a `number` of **dollars** at this boundary: the
 * backend serialises Postgres `DECIMAL` columns to JSON numbers. Server-side
 * arithmetic works in integer cents (see Phase 3 repricing); do not assume the
 * two representations are interchangeable when writing back.
 *
 * **Casing.** The API speaks camelCase; the adapter layer maps snake_case
 * columns on the way out. Field names here match the JSON exactly.
 *
 * **Nulls.** An absent column serialises as `null`, not as a missing key, so a
 * field marked `?:` here arrives as `null` in practice. The project compiles
 * with `strictNullChecks` off, so that mismatch is invisible to the type
 * checker - guard explicitly (`x != null`) rather than trusting `?:` when the
 * difference between `null` and `undefined` would change behaviour. Tightening
 * this is Phase 7 hardening.
 */

import type { ApiRole, AppRole, RolePermissions } from '../permissions';

export type { AppRole, Permission, RolePermissions, ApiRole } from '../permissions';

// ===== Auth =====

export interface LoginRequest {
  email: string;
  password: string;
}

/** Payload of POST /api/auth/login. */
export interface LoginResponse {
  token: string;
  /**
   * The token's lifetime as the server issued it (e.g. `'24h'`), so the client
   * does not have to assume one. Optional for compatibility with a backend
   * predating this field.
   */
  expiresIn?: string;
  user: {
    id: string;
    email: string;
    name: string;
    roleIds: string[];
    roles: ApiRole[];
  };
}

/** Payload of GET /api/auth/session. */
export interface SessionResponse {
  user: {
    id: string;
    email: string;
    name: string;
    roleIds: string[];
    status: string;
    roles: ApiRole[];
  };
}

// ===== Catalog =====

export interface Category {
  id: string;
  name: string;
  icon?: string;
}

export interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  priceOverride?: number;
  priceDelta?: number;
  sku?: string;
  barcode?: string;
  stock: number;
  enabled: boolean;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  category: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants: ProductVariant[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  category?: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants?: Omit<ProductVariant, 'id'>[];
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  category?: string;
  basePrice?: number;
  image?: string;
  barcode?: string;
}

/**
 * Effective price of a variant.
 *
 * An override replaces the base price outright; otherwise the delta is added to
 * it. Kept client-side because the cart previews prices before the server
 * reprices the order.
 */
export function calculateVariantPrice(basePrice: number, variant: ProductVariant): number {
  if (variant.priceOverride !== undefined && variant.priceOverride !== null) {
    return variant.priceOverride;
  }
  return basePrice + (variant.priceDelta || 0);
}

// ===== Cart (client-only) =====

/**
 * A line in the register's working cart.
 *
 * Purely local state — it is never returned by the API, only converted into
 * {@link CreateOrderRequest} items at checkout.
 */
export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
  price: number;
  nameSnapshot?: string;
  size?: string;
  color?: string;
  notes?: string;
  lineDiscount?: number;
}

// ===== Orders =====

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
  notes?: string;
}

export interface Order {
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  cardTransactionId?: string;
  cardAuthCode?: string;
  items?: OrderItem[];
}

/**
 * A discount the register applied, as sent at checkout.
 *
 * The server resolves each against the discount catalog and computes the amount
 * itself — this only identifies *which* discount. `type`/`value` are read only
 * for a `manual` discount, and only from a caller allowed to grant one.
 */
export interface AppliedDiscountRequest {
  source: 'quick_discount' | 'promo_code' | 'manual' | 'employee';
  id?: string;
  code?: string;
  type?: 'percentage' | 'fixed';
  value?: number;
  reason?: string;
}

export interface CreateOrderRequest {
  items: Array<{
    productId: string;
    variantId?: string;
    nameSnapshot: string;
    size?: string;
    color?: string;
    quantity: number;
    unitPrice: number;
    lineDiscount?: number;
    lineTotal: number;
    notes?: string;
  }>;
  subtotal: number;
  /**
   * Ignored by the server, which reprices. Send `appliedDiscounts` to actually
   * take money off.
   */
  discountTotal?: number;
  taxTotal?: number;
  total: number;
  appliedDiscounts?: AppliedDiscountRequest[];
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  cardTransactionId?: string;
  cardAuthCode?: string;
}

// ===== Customers =====

export interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  tags?: string[];
  lastOrderAt?: number;
  lifetimeValue?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCustomerRequest {
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
}

export type UpdateCustomerRequest = Partial<CreateCustomerRequest>;

// ===== Services & quotes =====

/** Mirrors the `unitType` enum in `backend/src/api/routes/services.ts`. */
export type ServiceUnitType = 'flat' | 'hourly' | 'daily' | 'per_item';

export interface Service {
  id: string;
  name: string;
  category: string;
  description?: string;
  basePrice?: number;
  unitType: ServiceUnitType;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface QuoteItem {
  id: string;
  quoteId?: string;
  serviceId?: string;
  /** Joined from `services.name` when the line references a catalog service. */
  serviceName?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export interface Quote {
  id: string;
  customerId?: string;
  /** Joined from the customer record; not a column on `quotes`. */
  customerName?: string;
  customerEmail?: string;
  status: QuoteStatus;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes?: string;
  createdAt: number;
  expiresAt?: number;
  items: QuoteItem[];
}

// ===== Admin: users, roles, settings, audit =====

export interface Role {
  id: string;
  name: string;
  /** Set only on the built-in archetypes; custom roles leave it unset. */
  systemRole?: AppRole;
  permissions: RolePermissions;
}

/**
 * A staff account as the API returns it.
 *
 * No password hash: that column never leaves the server.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  status: 'active' | 'inactive';
  lastLoginAt?: number;
  createdAt: number;
}

/** Which tenders the register offers, and how the card one is wired. */
export interface PaymentMethodsConfig {
  cash?: { enabled: boolean };
  zelle?: { enabled: boolean; destination?: string };
  card?: { enabled: boolean; provider?: string };
}

/**
 * Per-provider terminal credentials.
 *
 * Only the keys for the configured `card.provider` are meaningful. These are
 * write-mostly: the settings form posts them, and the server uses them to build
 * a terminal adapter.
 */
export interface TerminalCredentials {
  stripeSecretKey?: string;
  stripeTerminalLocationId?: string;
  stripeReaderId?: string;
  squareAccessToken?: string;
  squareLocationId?: string;
  squareDeviceId?: string;
  cloverApiToken?: string;
  cloverMerchantId?: string;
  cloverDeviceId?: string;
  verifoneApiKey?: string;
  verifoneTerminalId?: string;
  verifoneMerchantId?: string;
  dejavooApiKey?: string;
  dejavooTerminalId?: string;
  dejavooMerchantId?: string;
}

/**
 * The free-form `settings.config` JSON column.
 *
 * The backend validates it only as `z.record(z.any())`, so this describes the
 * keys the app actually reads and writes rather than a guaranteed schema - treat
 * every field as possibly absent.
 */
export interface StoreConfig {
  authMethods?: {
    local?: boolean;
    google?: boolean;
    oidc?: boolean;
  };
  demoMode?: boolean;
  paymentMethods?: PaymentMethodsConfig;
  /**
   * Write-only. The server strips these from every response, so this is set when
   * *sending* new keys and is always absent on read - see
   * {@link StoreConfig.terminalCredentialsConfigured}. Omit it (or send `{}`) to
   * leave the stored keys untouched.
   */
  terminalCredentials?: TerminalCredentials;
  /** Read-only: whether any terminal credential is stored. */
  terminalCredentialsConfigured?: boolean;
}

export interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone?: string;
  logoUrl?: string;
  iconUrl?: string;
  brandColor?: string;
  config?: StoreConfig;
  // Receipt branding (migration 005)
  storeAddress?: string;
  storeCity?: string;
  storeState?: string;
  storeZip?: string;
  storeNumber?: string;
  receiptLogoUrl?: string;
  receiptHeaderText?: string;
  receiptFooterText?: string;
  receiptShowLogo?: boolean;
  receiptShowBarcode?: boolean;
}

export type UpdateSettingsRequest = Partial<Settings>;

export interface AuditLog {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

// ===== Returns (migration 003) =====

export type ReturnStatus = 'pending' | 'approved' | 'completed' | 'rejected';
export type ReturnKind = 'return' | 'exchange' | 'void';

export interface ReturnItem {
  id: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  originalQuantity: number;
  returnQuantity: number;
  unitPrice: number;
  lineTotal: number;
  condition: string;
  restocked: boolean;
  notes?: string;
}

export interface Return {
  id: string;
  originalOrderId: string;
  returnNumber: string;
  returnType: ReturnKind;
  status: ReturnStatus;
  customerEmail?: string;
  customerPhone?: string;
  customerId?: string;
  customerName?: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  refundMethod?: string;
  refundStatus: string;
  refundProcessedAt?: number;
  storeCreditAmount: number;
  storeCreditCode?: string;
  reasonCode?: string;
  reasonDetails?: string;
  internalNotes?: string;
  restockItems: boolean;
  restockingFee: number;
  createdByName?: string;
  approvedByName?: string;
  originalOrderTotal?: number;
  createdAt: number;
  updatedAt: number;
  items?: ReturnItem[];
}

export interface ReturnStats {
  totalReturns: number;
  completedReturns: number;
  pendingReturns: number;
  rejectedReturns: number;
  totalRefunded: number;
  totalStoreCredits: number;
  uniqueCustomers: number;
}

// ===== Discounts (migration 004) =====

export interface DiscountType {
  id: string;
  name: string;
  description?: string;
  code?: string;
  discountType: 'percentage' | 'fixed' | 'buy_x_get_y';
  discountValue: number;
  minPurchase: number;
  maxDiscount?: number | null;
  appliesTo: string;
  applicableIds: string[];
  requiresApproval: boolean;
  approvalThreshold?: number | null;
  requiresEmployeeId: boolean;
  displayOrder: number;
  color: string;
  icon?: string;
  showInPos: boolean;
  isActive: boolean;
  createdAt: number;
}

export interface PromoCode {
  id: string;
  code: string;
  name: string;
  description?: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping' | 'buy_x_get_y' | 'free_item';
  discountValue: number;
  minPurchase: number;
  maxDiscount?: number | null;
  maxUses?: number | null;
  maxUsesPerCustomer: number;
  currentUses: number;
  startsAt: number;
  expiresAt?: number | null;
  firstOrderOnly: boolean;
  stackable: boolean;
  isActive: boolean;
  createdAt: number;
  createdByName?: string;
}

export interface EmployeeDiscount {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  discountPercentage: number;
  maxDiscountAmount?: number | null;
  currentMonthUsage: number;
  requiresManagerApprovalAbove?: number | null;
  isActive: boolean;
  approvedByName?: string;
  approvedAt?: number;
}

/** Aggregate discount figures shown on the summary cards. */
export interface DiscountStats {
  totalDiscounts: number;
  totalDiscountAmount: number;
}
