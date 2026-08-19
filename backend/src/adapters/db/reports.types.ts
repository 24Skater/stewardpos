/**
 * The shapes the reporting aggregations return.
 *
 * Lives beside the adapters rather than with the reports service because both
 * adapters implement these queries and the service only composes what they
 * return. `DatabaseAdapter` is a union of the two concrete classes, so the two
 * signatures have to match exactly or every call site stops typechecking — these
 * types are what keeps them honest.
 *
 * **Every amount is dollars**, matching the `DECIMAL(10,2)` columns and the rest
 * of the API boundary. Derived figures (an average, a net of refunds) are
 * computed in integer cents by the service before they come back out here.
 */

/**
 * A closed date range in epoch milliseconds.
 *
 * Both ends are **inclusive**. A caller asking for `to=2026-08-16` means "up to
 * the end of the 16th", and the service is what turns a date into that instant;
 * the adapters just compare.
 */
export interface ReportRange {
  from: number;
  to: number;
}

/** Order totals over a range. `gross - discounts + tax` equals `net`. */
export interface SalesTotals {
  orderCount: number;
  /** Sum of `orders.subtotal`: line totals before discount and tax. */
  gross: number;
  discounts: number;
  tax: number;
  /** Sum of `orders.total`: what was actually charged. */
  net: number;
}

/** One day's takings, keyed by local calendar date (`YYYY-MM-DD`). */
export interface SalesByDay {
  date: string;
  orderCount: number;
  gross: number;
  net: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

/** Tender split. `method` is lower-cased so 'Cash' and 'cash' are one bucket. */
export interface PaymentMix {
  method: string;
  count: number;
  amount: number;
}

/**
 * Refund totals over a range.
 *
 * `refunded` counts **completed** returns only — a pending return has not paid
 * anything out yet, and counting it would understate the day's takings against
 * every other screen. What is pending is reported separately rather than hidden,
 * because money about to leave is worth seeing.
 */
export interface ReturnsTotals {
  returnCount: number;
  refunded: number;
  pendingCount: number;
  pendingAmount: number;
}

export interface ReturnsByReason {
  reasonCode: string;
  returnCount: number;
  refunded: number;
}

/**
 * What a report can be narrowed by, on top of its date range.
 *
 * Additive: every query already built accepts `undefined` for this and behaves
 * exactly as it did before this phase. An empty array is treated the same as
 * `undefined` — a caller building `?registerIds=` from an emptied multi-select
 * should get the unfiltered report back, not zero rows.
 */
export interface RegisterFilter {
  registerIds?: string[];
  locationIds?: string[];
  cashierUserIds?: string[];
}

/**
 * Sales attributed to the physical till that rang them.
 *
 * Deliberately an inner join on activity: a register with no orders in range
 * does not appear at all, active or not. A **retired or disabled** register
 * that traded during the range still does — nothing here filters on
 * `registers.status`, on purpose. A report that silently dropped a
 * decommissioned till would understate the period it claims to cover.
 */
export interface SalesByRegister {
  registerId: string;
  displayCode: string;
  name: string;
  locationId: string;
  locationName: string;
  /** fixed | mobile | web | kiosk */
  type: string;
  hasCashDrawer: boolean;
  /** pending | active | disabled | retired */
  status: string;
  orderCount: number;
  gross: number;
  discounts: number;
  tax: number;
  net: number;
}

/**
 * Sales attributed to whoever was actually standing at the till.
 *
 * `cashier_user_id` is written once, at checkout, from that order's open
 * `register_shifts` row — never re-derived from whichever shift happens to be
 * open when the report runs. A shift starting on the same register after the
 * sale must not repaint it.
 *
 * `cashierUserId: 'unknown'` buckets orders that predate migration 016 (the
 * column is NULL for all history before it), so the per-cashier split still
 * reconciles to the same total as the unfiltered range instead of quietly
 * losing pre-migration orders.
 */
export interface SalesByCashier {
  cashierUserId: string;
  cashierName: string;
  orderCount: number;
  gross: number;
  net: number;
}

/** Sales rolled up to the site level. `registerCount` counts only registers that actually traded in range. */
export interface SalesByLocation {
  locationId: string;
  locationName: string;
  registerCount: number;
  orderCount: number;
  net: number;
}

/**
 * How a register's drawer counts reconciled — the report that catches theft
 * and counting mistakes.
 *
 * Scoped to `status = 'closed'` sessions whose `closed_at` falls in range: a
 * variance is only known once a session is closed, and an open session's
 * `variance` column is NULL.
 */
export interface DrawerVarianceByRegister {
  registerId: string;
  displayCode: string;
  name: string;
  sessionCount: number;
  /** Sum of `counted_cash - expected_cash` across the register's closed sessions in range. */
  totalVariance: number;
  /** The most negative variance in the set — the worst single shortfall. `0` when every session in range was on or over. */
  worstVariance: number;
  /** Sessions that closed under expected (`variance < 0`). */
  shortCount: number;
}

/**
 * `register_overrides` rows with `action = 'no_sale'` — a drawer opened with
 * nothing rung up. The single best theft signal a POS can report on, so this
 * counts only that one action rather than every override ever granted.
 */
export interface NoSaleCount {
  registerId: string;
  displayCode: string;
  name: string;
  noSaleCount: number;
}

/** One register's trading by hour of its **location's local day**, for staffing decisions. Only hours with at least one order are present. */
export interface RegisterHourly {
  /** 0–23, local to the register's location. */
  hour: number;
  orderCount: number;
  net: number;
}

/**
 * What the audit trail can be narrowed by.
 *
 * `from`/`to` are epoch milliseconds and inclusive, matching {@link ReportRange}
 * — an admin filtering "what changed on Tuesday" is asking the same kind of
 * question a report asks, and two different meanings of a date range on the same
 * admin surface is a bug waiting to be filed.
 */
export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  userId?: string;
  entity?: string;
  action?: string;
  from?: number;
  to?: number;
}
