import { ValidationError } from '../utils/errors';
import { toCents, toDollars } from './pricing';
import db from './database';
import type {
  PaymentMix,
  ReportRange,
  ReturnsByReason,
  ReturnsTotals,
  SalesByDay,
  TopProduct,
} from '../adapters/db/reports.types';

/**
 * Reporting: what a range of trading added up to.
 *
 * Every figure here comes from persisted, server-repriced rows and is summed by
 * the database. The reports screens used to download the entire orders table and
 * add it up in the browser, which made every report a function of how many
 * orders the client could hold and quietly ruled out ever paginating the list
 * endpoints — a cap there would have turned "the month's takings" into "the
 * takings of the fifty orders that happened to come back".
 *
 * Sums are done in SQL. Anything *derived* from those sums — an average, a net
 * of refunds — is computed here in integer cents, for the reason set out in
 * `pricing.ts`: dollars as floating-point numbers do not survive division and
 * subtraction intact, and a report is read as a statement of fact.
 */

/** Bounds on `?limit=` for the top-products list. */
const TOP_PRODUCTS_DEFAULT = 10;
const TOP_PRODUCTS_MAX = 100;

/** How far back a report reaches when the caller does not say. */
const DEFAULT_RANGE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn one `?from=`/`?to=` value into an instant.
 *
 * Accepts a plain `YYYY-MM-DD` — what a date picker sends — or epoch
 * milliseconds, which is what the API hands out for every other timestamp and
 * therefore what a script written against it will have.
 *
 * A date-only value is read as **UTC**, and `to` is stretched to the last
 * millisecond of that day so that `from=2026-08-01&to=2026-08-01` is a day's
 * trading rather than a single instant with nothing in it. UTC because that is
 * how both adapters bucket days; see the note in `SQLiteAdapter`.
 */
function parseBound(value: string, label: string, endOfDay: boolean): number {
  if (DATE_ONLY.test(value)) {
    const midnight = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(midnight)) {
      throw new ValidationError(`"${label}" is not a valid date`);
    }
    return endOfDay ? midnight + MS_PER_DAY - 1 : midnight;
  }

  const epoch = Number(value);
  if (!Number.isFinite(epoch)) {
    throw new ValidationError(`"${label}" must be a YYYY-MM-DD date or epoch milliseconds`);
  }
  return Math.trunc(epoch);
}

/**
 * The range a request is asking about.
 *
 * Defaults to the last {@link DEFAULT_RANGE_DAYS} days ending now, so an
 * unparameterised call returns something meaningful rather than everything ever
 * sold.
 */
export function parseRange(
  query: { from?: string; to?: string },
  now: number = Date.now()
): ReportRange {
  const to = query.to === undefined ? now : parseBound(query.to, 'to', true);
  const from =
    query.from === undefined
      ? to - DEFAULT_RANGE_DAYS * MS_PER_DAY
      : parseBound(query.from, 'from', false);

  if (from > to) {
    throw new ValidationError('The start of the range must not be after its end');
  }

  return { from, to };
}

/** Clamp `?limit=` for top products. */
export function parseTopProductsLimit(value: string | undefined): number {
  if (value === undefined) return TOP_PRODUCTS_DEFAULT;

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError('"limit" must be a whole number of at least 1');
  }
  return Math.min(limit, TOP_PRODUCTS_MAX);
}

export interface SalesSummary extends ReportRange {
  orderCount: number;
  gross: number;
  discounts: number;
  tax: number;
  net: number;
  /** Completed refunds raised in this range. */
  refunds: number;
  /** `net - refunds`: what the shop actually kept. */
  netAfterRefunds: number;
  avgTicket: number;
  /** Approved or pending returns — money not yet out, but committed. */
  pendingRefunds: number;
}

/**
 * The headline figures.
 *
 * Refunds are matched on the date the **return** was raised, not the date of the
 * sale it refers to. A report for last week that silently rewrote itself when
 * something sold in it came back this week would not reconcile with anything
 * printed from it earlier.
 */
export async function getSalesSummary(range: ReportRange): Promise<SalesSummary> {
  const adapter = db.getAdapter();
  const [totals, returns] = await Promise.all([
    adapter.getSalesTotals(range),
    adapter.getReturnsTotals(range),
  ]);

  const netCents = toCents(totals.net);
  const refundCents = toCents(returns.refunded);

  return {
    ...range,
    orderCount: totals.orderCount,
    gross: totals.gross,
    discounts: totals.discounts,
    tax: totals.tax,
    net: totals.net,
    refunds: returns.refunded,
    netAfterRefunds: toDollars(netCents - refundCents),
    // Rounded to the cent rather than left as a repeating fraction: it is
    // displayed as money, and `$33.333333333333336` is not money.
    avgTicket: totals.orderCount === 0 ? 0 : toDollars(Math.round(netCents / totals.orderCount)),
    pendingRefunds: returns.pendingAmount,
  };
}

export async function getSalesByDay(range: ReportRange): Promise<SalesByDay[]> {
  return db.getAdapter().getSalesByDay(range);
}

export async function getTopProducts(range: ReportRange, limit: number): Promise<TopProduct[]> {
  return db.getAdapter().getTopProducts(range, limit);
}

export async function getPaymentMix(range: ReportRange): Promise<PaymentMix[]> {
  return db.getAdapter().getPaymentMix(range);
}

export interface ReturnsSummary extends ReportRange, ReturnsTotals {
  byReason: ReturnsByReason[];
}

export async function getReturnsSummary(range: ReportRange): Promise<ReturnsSummary> {
  const adapter = db.getAdapter();
  const [totals, byReason] = await Promise.all([
    adapter.getReturnsTotals(range),
    adapter.getReturnsByReason(range),
  ]);

  return { ...range, ...totals, byReason };
}
