import { apiClient } from '../api-client';
import { qs } from './qs';
import type { RegisterStatus, RegisterType } from './registers';

/**
 * Reporting: figures the server computed, not figures the browser added up.
 *
 * Every one of these screens used to call `ordersApi.list()` and aggregate the
 * whole orders table client-side. That made a report a function of how much the
 * browser could hold, and it is why the list endpoints still cannot be paged —
 * a cap there would have quietly turned "this month" into "the last fifty
 * orders". These endpoints sum in SQL instead.
 */

/**
 * A reporting window, narrowed to a subset of tills, sites, or staff.
 *
 * `from` and `to` are `YYYY-MM-DD` or epoch milliseconds, and **both ends are
 * inclusive** — asking for `to` on a date means the whole of that day, which is
 * what a date picker means by it.
 *
 * `registerIds` / `locationIds` / `cashierUserIds` are additive on top of the
 * range and every report endpoint accepts all three, whether or not a given
 * screen exposes a control for it — `registerHourly` parses them but never
 * uses them, since its required `registerId` already narrows to one till.
 * `qs()` sends a populated array comma-separated and drops an empty one
 * entirely, so a multi-select cleared down to nothing reads as "no filter",
 * matching how the backend's `parseIdList` treats an absent parameter.
 */
export interface ReportRangeQuery {
  from?: string;
  to?: string;
  registerIds?: string[];
  locationIds?: string[];
  cashierUserIds?: string[];
}

export interface SalesSummary {
  /** The range the server actually answered for, in epoch milliseconds. */
  from: number;
  to: number;
  orderCount: number;
  /** Line totals before discount and tax. */
  gross: number;
  discounts: number;
  tax: number;
  /** What was charged: `gross - discounts + tax`. */
  net: number;
  /** Completed refunds raised in this range. */
  refunds: number;
  netAfterRefunds: number;
  avgTicket: number;
  /** Returns approved or awaiting approval — committed, not yet paid out. */
  pendingRefunds: number;
}

export interface SalesByDay {
  /** `YYYY-MM-DD`. */
  date: string;
  orderCount: number;
  gross: number;
  net: number;
}

export interface TopProduct {
  productId: string;
  /** The name as sold, so a later rename cannot rewrite an old report. */
  name: string;
  quantity: number;
  revenue: number;
}

export interface PaymentMix {
  method: string;
  count: number;
  amount: number;
}

export interface ReturnsByReason {
  reasonCode: string;
  returnCount: number;
  refunded: number;
}

export interface ReturnsSummary {
  from: number;
  to: number;
  returnCount: number;
  refunded: number;
  pendingCount: number;
  pendingAmount: number;
  byReason: ReturnsByReason[];
}

export interface TopProductsQuery extends ReportRangeQuery {
  /** Server-capped at 100. */
  limit?: number;
}

/**
 * Sales attributed to the physical till that rang them — how many sales went
 * through each register, the question this whole phase exists to answer.
 *
 * A register with no orders in range does not appear at all, active or not.
 * A **retired or disabled** register that traded during the range still does
 * — the backend deliberately does not filter on `status`, so a report that
 * silently dropped a decommissioned till would understate the period it
 * claims to cover.
 */
export interface RegisterSales {
  registerId: string;
  displayCode: string;
  name: string;
  locationId: string;
  locationName: string;
  type: RegisterType;
  hasCashDrawer: boolean;
  status: RegisterStatus;
  orderCount: number;
  gross: number;
  discounts: number;
  tax: number;
  net: number;
  avgTicket: number;
}

export interface RegisterCapabilityBucket {
  registerCount: number;
  orderCount: number;
  net: number;
}

/**
 * Web-vs-drawer, as the user asked for it explicitly: how much of the
 * period's trading went through a till that can even hold cash. Derived from
 * each register's own `hasCashDrawer` flag, not its `type` — a mobile or
 * kiosk register may or may not carry a drawer.
 */
export interface DrawerCapabilitySplit {
  drawerCapable: RegisterCapabilityBucket;
  nonDrawerCapable: RegisterCapabilityBucket;
}

export interface SalesByRegisterResult {
  registers: RegisterSales[];
  capabilitySplit: DrawerCapabilitySplit;
}

/**
 * Sales attributed to whoever was actually standing at the till, not
 * whoever is signed in when the report runs.
 *
 * `cashierUserId: 'unknown'` buckets orders that predate the cashier-shift
 * migration, so the per-cashier split still reconciles to the same total as
 * the unfiltered range instead of quietly losing pre-migration orders.
 */
export interface CashierSales {
  cashierUserId: string;
  cashierName: string;
  orderCount: number;
  gross: number;
  net: number;
  avgTicket: number;
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
 * and counting mistakes. Scoped to closed sessions only: a variance is only
 * known once a session is closed.
 */
export interface DrawerVarianceByRegister {
  registerId: string;
  displayCode: string;
  name: string;
  sessionCount: number;
  /** Sum of `counted - expected` across the register's closed sessions in range. */
  totalVariance: number;
  /** The most negative variance in the set — the worst single shortfall. `0` when every session in range was on or over. */
  worstVariance: number;
  /** Sessions that closed under expected. */
  shortCount: number;
}

/**
 * Drawers opened with nothing rung up — the single best theft signal a POS
 * can report on.
 */
export interface NoSaleCount {
  registerId: string;
  displayCode: string;
  name: string;
  noSaleCount: number;
}

/** One register's trading by hour of its location's local day, for staffing decisions. Only hours with at least one order are present. */
export interface RegisterHourly {
  /** 0–23, local to the register's location. */
  hour: number;
  orderCount: number;
  net: number;
}

export interface RegisterHourlyQuery extends ReportRangeQuery {
  registerId: string;
}

export const reportsApi = {
  salesSummary: (range?: ReportRangeQuery) =>
    apiClient.get<SalesSummary>(`/api/reports/sales-summary${qs(range)}`),

  salesByDay: (range?: ReportRangeQuery) =>
    apiClient.get<SalesByDay[]>(`/api/reports/sales-by-day${qs(range)}`),

  topProducts: (query?: TopProductsQuery) =>
    apiClient.get<TopProduct[]>(`/api/reports/top-products${qs(query)}`),

  paymentMix: (range?: ReportRangeQuery) =>
    apiClient.get<PaymentMix[]>(`/api/reports/payment-mix${qs(range)}`),

  returnsSummary: (range?: ReportRangeQuery) =>
    apiClient.get<ReturnsSummary>(`/api/reports/returns-summary${qs(range)}`),

  /** How many sales went through each till, plus the web-vs-drawer split. */
  salesByRegister: (range?: ReportRangeQuery) =>
    apiClient.get<SalesByRegisterResult>(`/api/reports/sales-by-register${qs(range)}`),

  /** Sales attributed to whoever rang them at checkout. */
  salesByCashier: (range?: ReportRangeQuery) =>
    apiClient.get<CashierSales[]>(`/api/reports/sales-by-cashier${qs(range)}`),

  salesByLocation: (range?: ReportRangeQuery) =>
    apiClient.get<SalesByLocation[]>(`/api/reports/sales-by-location${qs(range)}`),

  /** The report that catches problems: which drawers are closing short, and by how much. */
  drawerVarianceByRegister: (range?: ReportRangeQuery) =>
    apiClient.get<DrawerVarianceByRegister[]>(`/api/reports/drawer-variance-by-register${qs(range)}`),

  /** The single best theft signal a POS can report on: drawers opened with nothing rung up. */
  noSaleCounts: (range?: ReportRangeQuery) =>
    apiClient.get<NoSaleCount[]>(`/api/reports/no-sale-counts${qs(range)}`),

  /** One register's trading by hour of its location's local day, for staffing decisions. */
  registerHourly: (query: RegisterHourlyQuery) =>
    apiClient.get<RegisterHourly[]>(`/api/reports/register-hourly${qs(query)}`),
};
