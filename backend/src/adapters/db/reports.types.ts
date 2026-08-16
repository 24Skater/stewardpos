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
