import { ValidationError } from '../utils/errors';
import { toCents, toDollars } from './pricing';
import db from './database';
import type {
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

/**
 * One `?registerIds=`-shaped query value into a clean id list.
 *
 * Express (via `qs`) turns `?registerIds=a&registerIds=b` into `['a', 'b']`
 * already, so a bare array is accepted as-is. A single value may itself be
 * comma-separated (`?registerIds=a,b`), which is split too, so either
 * convention a caller reaches for works. An empty result — nothing supplied,
 * or a multi-select cleared down to `?registerIds=` — comes back as
 * `undefined` rather than `[]`, so the SQL layer's "empty array means no
 * filter" rule stays in exactly one place instead of being duplicated here.
 */
function parseIdList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;

  const raw = Array.isArray(value) ? value : [value];
  const ids = raw
    .flatMap((entry) => entry.split(','))
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return ids.length > 0 ? ids : undefined;
}

/**
 * The register/location/cashier narrowing every report endpoint now accepts,
 * on top of its date range. Additive and always optional — a request with
 * none of these query parameters gets back the same unfiltered report as
 * before this phase.
 */
export function parseRegisterFilter(query: {
  registerIds?: string | string[];
  locationIds?: string | string[];
  cashierUserIds?: string | string[];
}): RegisterFilter {
  return {
    registerIds: parseIdList(query.registerIds),
    locationIds: parseIdList(query.locationIds),
    cashierUserIds: parseIdList(query.cashierUserIds),
  };
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
export async function getSalesSummary(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<SalesSummary> {
  const adapter = db.getAdapter();
  const [totals, returns] = await Promise.all([
    adapter.getSalesTotals(range, filter),
    adapter.getReturnsTotals(range, filter),
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

export async function getSalesByDay(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<SalesByDay[]> {
  return db.getAdapter().getSalesByDay(range, filter);
}

export async function getTopProducts(
  range: ReportRange,
  limit: number,
  filter: RegisterFilter = {}
): Promise<TopProduct[]> {
  return db.getAdapter().getTopProducts(range, limit, filter);
}

export async function getPaymentMix(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<PaymentMix[]> {
  return db.getAdapter().getPaymentMix(range, filter);
}

export interface ReturnsSummary extends ReportRange, ReturnsTotals {
  byReason: ReturnsByReason[];
}

export async function getReturnsSummary(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<ReturnsSummary> {
  const adapter = db.getAdapter();
  const [totals, byReason] = await Promise.all([
    adapter.getReturnsTotals(range, filter),
    adapter.getReturnsByReason(range, filter),
  ]);

  return { ...range, ...totals, byReason };
}

/**
 * `net` rounded to the cent per order, `0` rather than a division by zero.
 * Shared by the per-register and per-cashier compositions below — the same
 * rule `getSalesSummary` applies to the unfiltered range, applied per group.
 */
function averageTicket(net: number, orderCount: number): number {
  if (orderCount === 0) return 0;
  return toDollars(Math.round(toCents(net) / orderCount));
}

export interface RegisterSales extends SalesByRegister {
  avgTicket: number;
}

/** How many sales went through each till — the report this whole phase exists for. */
export async function getSalesByRegister(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<RegisterSales[]> {
  const rows = await db.getAdapter().getSalesByRegister(range, filter);
  return rows.map((row) => ({ ...row, avgTicket: averageTicket(row.net, row.orderCount) }));
}

export interface CashierSales extends SalesByCashier {
  avgTicket: number;
}

/** Sales attributed to whoever rang them at checkout, not whoever is signed in now. */
export async function getSalesByCashier(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<CashierSales[]> {
  const rows = await db.getAdapter().getSalesByCashier(range, filter);
  return rows.map((row) => ({ ...row, avgTicket: averageTicket(row.net, row.orderCount) }));
}

export async function getSalesByLocation(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<SalesByLocation[]> {
  return db.getAdapter().getSalesByLocation(range, filter);
}

/** The report that catches problems: which drawers are closing short, and by how much. */
export async function getDrawerVarianceByRegister(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<DrawerVarianceByRegister[]> {
  return db.getAdapter().getDrawerVarianceByRegister(range, filter);
}

/** The single best theft signal a POS can report on: drawers opened with nothing rung up. */
export async function getNoSaleCounts(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<NoSaleCount[]> {
  return db.getAdapter().getNoSaleCounts(range, filter);
}

/** One register's trading by hour of its location's local day, for staffing decisions. */
export async function getRegisterHourly(
  range: ReportRange,
  registerId: string
): Promise<RegisterHourly[]> {
  return db.getAdapter().getRegisterHourly(range, registerId);
}

interface CapabilityBucket {
  registerCount: number;
  orderCount: number;
  net: number;
}

export interface DrawerCapabilitySplit {
  drawerCapable: CapabilityBucket;
  nonDrawerCapable: CapabilityBucket;
}

/**
 * Web-vs-drawer, as the user asked for it explicitly: how much of the
 * period's trading went through a till that can even hold cash.
 *
 * Derived here from `getSalesByRegister`'s own `hasCashDrawer` flag rather
 * than persisted anywhere — `type` (`fixed | mobile | web | kiosk`) is
 * descriptive of the till, but `hasCashDrawer` is the actual capability that
 * matters for this split, since a mobile or kiosk register may or may not
 * carry a drawer. Composed in integer cents: summing several rows' already-
 * rounded dollar amounts as JavaScript floating-point numbers can reintroduce
 * the same drift `pricing.ts` describes, even though each row arrived from
 * the database already exact.
 */
export async function getRegisterCapabilitySplit(
  range: ReportRange,
  filter: RegisterFilter = {}
): Promise<DrawerCapabilitySplit> {
  const registers = await db.getAdapter().getSalesByRegister(range, filter);

  const drawerCapable = { registerCount: 0, orderCount: 0, netCents: 0 };
  const nonDrawerCapable = { registerCount: 0, orderCount: 0, netCents: 0 };

  for (const register of registers) {
    const bucket = register.hasCashDrawer ? drawerCapable : nonDrawerCapable;
    bucket.registerCount += 1;
    bucket.orderCount += register.orderCount;
    bucket.netCents += toCents(register.net);
  }

  return {
    drawerCapable: {
      registerCount: drawerCapable.registerCount,
      orderCount: drawerCapable.orderCount,
      net: toDollars(drawerCapable.netCents),
    },
    nonDrawerCapable: {
      registerCount: nonDrawerCapable.registerCount,
      orderCount: nonDrawerCapable.orderCount,
      net: toDollars(nonDrawerCapable.netCents),
    },
  };
}
