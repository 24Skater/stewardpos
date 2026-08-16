import { apiClient } from '../api-client';
import { qs } from './qs';

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
 * A reporting window.
 *
 * `from` and `to` are `YYYY-MM-DD` or epoch milliseconds, and **both ends are
 * inclusive** — asking for `to` on a date means the whole of that day, which is
 * what a date picker means by it.
 */
export interface ReportRangeQuery {
  from?: string;
  to?: string;
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
};
