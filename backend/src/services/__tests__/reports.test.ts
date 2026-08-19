import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationError } from '../../utils/errors';

/**
 * The reporting service's own logic: what a range means, and the figures that
 * are derived rather than summed.
 *
 * The sums themselves belong to the adapters and are covered against a real
 * database in `adapters/db/__tests__/integration/reports.integration.test.ts`.
 * What is worth testing here is everything the SQL cannot get wrong: a date with
 * no time on it, a range with nothing in it, an average over zero orders, and
 * the subtraction of refunds from takings.
 */
const getSalesTotals = vi.fn();
const getReturnsTotals = vi.fn();
const getReturnsByReason = vi.fn();
const getSalesByDay = vi.fn();
const getTopProducts = vi.fn();
const getPaymentMix = vi.fn();
const getSalesByRegister = vi.fn();
const getSalesByCashier = vi.fn();
const getSalesByLocation = vi.fn();
const getDrawerVarianceByRegister = vi.fn();
const getNoSaleCounts = vi.fn();
const getRegisterHourly = vi.fn();

vi.mock('../database', () => ({
  default: {
    getAdapter: () => ({
      getSalesTotals,
      getReturnsTotals,
      getReturnsByReason,
      getSalesByDay,
      getTopProducts,
      getPaymentMix,
      getSalesByRegister,
      getSalesByCashier,
      getSalesByLocation,
      getDrawerVarianceByRegister,
      getNoSaleCounts,
      getRegisterHourly,
    }),
  },
}));

const reports = await import('../reports');

const NO_SALES = { orderCount: 0, gross: 0, discounts: 0, tax: 0, net: 0 };
const NO_RETURNS = { returnCount: 0, refunded: 0, pendingCount: 0, pendingAmount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  getSalesTotals.mockResolvedValue(NO_SALES);
  getReturnsTotals.mockResolvedValue(NO_RETURNS);
  getReturnsByReason.mockResolvedValue([]);
});

describe('parseRange', () => {
  const NOW = Date.parse('2026-08-16T09:30:00.000Z');

  it('reads a plain date as the whole of that day', () => {
    // The half a user means by "1 to 1 August" is a day of trading, not the
    // single instant of midnight, which would contain nothing.
    const range = reports.parseRange({ from: '2026-08-01', to: '2026-08-01' }, NOW);

    expect(range.from).toBe(Date.parse('2026-08-01T00:00:00.000Z'));
    expect(range.to).toBe(Date.parse('2026-08-01T23:59:59.999Z'));
  });

  it('accepts epoch milliseconds, which is what the rest of the API hands out', () => {
    const range = reports.parseRange({ from: '1000', to: '2000' }, NOW);

    expect(range).toEqual({ from: 1000, to: 2000 });
  });

  it('defaults to the last thirty days ending now', () => {
    const range = reports.parseRange({}, NOW);

    expect(range.to).toBe(NOW);
    expect(range.from).toBe(NOW - 30 * 24 * 60 * 60 * 1000);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => reports.parseRange({ from: '2026-08-16', to: '2026-08-01' }, NOW)).toThrow(
      ValidationError
    );
  });

  it('refuses a value that is neither a date nor a number', () => {
    expect(() => reports.parseRange({ from: 'last tuesday' }, NOW)).toThrow(ValidationError);
  });
});

describe('parseTopProductsLimit', () => {
  it('defaults to ten', () => {
    expect(reports.parseTopProductsLimit(undefined)).toBe(10);
  });

  it('caps a large request rather than refusing it', () => {
    expect(reports.parseTopProductsLimit('5000')).toBe(100);
  });

  it('refuses a limit that is not a whole number of at least one', () => {
    expect(() => reports.parseTopProductsLimit('0')).toThrow(ValidationError);
    expect(() => reports.parseTopProductsLimit('2.5')).toThrow(ValidationError);
  });
});

describe('getSalesSummary', () => {
  const RANGE = { from: 0, to: 100 };

  it('reconciles: gross less discounts plus tax is the net', async () => {
    getSalesTotals.mockResolvedValue({
      orderCount: 3,
      gross: 100,
      discounts: 10,
      tax: 7.2,
      net: 97.2,
    });

    const summary = await reports.getSalesSummary(RANGE);

    expect(summary.gross - summary.discounts + summary.tax).toBeCloseTo(summary.net, 2);
  });

  it('subtracts only completed refunds from the takings', async () => {
    getSalesTotals.mockResolvedValue({ ...NO_SALES, orderCount: 2, net: 50 });
    getReturnsTotals.mockResolvedValue({
      returnCount: 1,
      refunded: 12.5,
      pendingCount: 1,
      pendingAmount: 30,
    });

    const summary = await reports.getSalesSummary(RANGE);

    expect(summary.netAfterRefunds).toBe(37.5);
    // Reported, not deducted: nothing has been paid out on a pending return.
    expect(summary.pendingRefunds).toBe(30);
  });

  it('averages in cents, so the ticket is a price and not a fraction', async () => {
    // 100 / 3 in floating dollars is 33.333333333333336, which is not money.
    getSalesTotals.mockResolvedValue({ ...NO_SALES, orderCount: 3, net: 100 });

    const summary = await reports.getSalesSummary(RANGE);

    expect(summary.avgTicket).toBe(33.33);
  });

  it('reports zero rather than dividing by no orders', async () => {
    const summary = await reports.getSalesSummary(RANGE);

    expect(summary.avgTicket).toBe(0);
    expect(summary.orderCount).toBe(0);
    expect(Number.isNaN(summary.avgTicket)).toBe(false);
  });

  it('carries the range it answered for', async () => {
    const summary = await reports.getSalesSummary(RANGE);

    // Exports print the period they cover; they read it from here rather than
    // re-deriving it, so the paper and the screen cannot disagree.
    expect(summary).toMatchObject({ from: 0, to: 100 });
  });
});

describe('getReturnsSummary', () => {
  it('puts the totals and the reasons in one payload', async () => {
    getReturnsTotals.mockResolvedValue({
      returnCount: 2,
      refunded: 40,
      pendingCount: 0,
      pendingAmount: 0,
    });
    getReturnsByReason.mockResolvedValue([
      { reasonCode: 'defective', returnCount: 1, refunded: 25 },
      { reasonCode: 'unspecified', returnCount: 1, refunded: 15 },
    ]);

    const summary = await reports.getReturnsSummary({ from: 0, to: 1 });

    expect(summary.refunded).toBe(40);
    expect(summary.byReason).toHaveLength(2);
    // The breakdown adds up to the total it is a breakdown of.
    expect(summary.byReason.reduce((sum, r) => sum + r.refunded, 0)).toBe(summary.refunded);
  });
});

describe('parseRegisterFilter', () => {
  it('leaves every field undefined when nothing was supplied', () => {
    expect(reports.parseRegisterFilter({})).toEqual({
      registerIds: undefined,
      locationIds: undefined,
      cashierUserIds: undefined,
    });
  });

  it('accepts what qs hands back for a repeated query parameter', () => {
    // `?registerIds=a&registerIds=b` arrives as an array already.
    const filter = reports.parseRegisterFilter({ registerIds: ['r1', 'r2'] });

    expect(filter.registerIds).toEqual(['r1', 'r2']);
  });

  it('splits a comma-separated value', () => {
    const filter = reports.parseRegisterFilter({ locationIds: 'l1,l2,l3' });

    expect(filter.locationIds).toEqual(['l1', 'l2', 'l3']);
  });

  it('treats an emptied multi-select as no filter, not a filter matching nothing', () => {
    const filter = reports.parseRegisterFilter({ cashierUserIds: '' });

    expect(filter.cashierUserIds).toBeUndefined();
  });
});

describe('getSalesByRegister', () => {
  const RANGE = { from: 0, to: 100 };

  it('threads the filter through to the adapter', async () => {
    getSalesByRegister.mockResolvedValue([]);
    const filter = { registerIds: ['r1'] };

    await reports.getSalesByRegister(RANGE, filter);

    expect(getSalesByRegister).toHaveBeenCalledWith(RANGE, filter);
  });

  it('defaults to an empty filter when none is given', async () => {
    getSalesByRegister.mockResolvedValue([]);

    await reports.getSalesByRegister(RANGE);

    expect(getSalesByRegister).toHaveBeenCalledWith(RANGE, {});
  });

  it('adds avgTicket per register, rounded to the cent', async () => {
    getSalesByRegister.mockResolvedValue([
      {
        registerId: 'r1',
        displayCode: 'MAIN-01',
        name: 'Register 1',
        locationId: 'l1',
        locationName: 'Main',
        type: 'fixed',
        hasCashDrawer: true,
        status: 'active',
        orderCount: 3,
        gross: 100,
        discounts: 0,
        tax: 0,
        net: 100,
      },
    ]);

    const rows = await reports.getSalesByRegister(RANGE);

    // 100 / 3 in floating dollars is 33.333333333333336, which is not money.
    expect(rows[0].avgTicket).toBe(33.33);
  });

  it('reports zero rather than dividing by no orders', async () => {
    getSalesByRegister.mockResolvedValue([
      {
        registerId: 'r1',
        displayCode: 'MAIN-01',
        name: 'Register 1',
        locationId: 'l1',
        locationName: 'Main',
        type: 'fixed',
        hasCashDrawer: true,
        status: 'active',
        orderCount: 0,
        gross: 0,
        discounts: 0,
        tax: 0,
        net: 0,
      },
    ]);

    const rows = await reports.getSalesByRegister(RANGE);

    expect(rows[0].avgTicket).toBe(0);
    expect(Number.isNaN(rows[0].avgTicket)).toBe(false);
  });
});

describe('getSalesByCashier', () => {
  it('adds avgTicket per cashier, rounded to the cent', async () => {
    getSalesByCashier.mockResolvedValue([
      { cashierUserId: 'u1', cashierName: 'Alex', orderCount: 3, gross: 10, net: 10 },
    ]);

    const rows = await reports.getSalesByCashier({ from: 0, to: 1 });

    expect(rows[0].avgTicket).toBe(3.33);
  });
});

describe('getSalesByLocation, getDrawerVarianceByRegister, getNoSaleCounts, getRegisterHourly', () => {
  it('pass their filter straight through to the adapter', async () => {
    const RANGE = { from: 0, to: 1 };
    const filter = { locationIds: ['l1'] };
    getSalesByLocation.mockResolvedValue([]);
    getDrawerVarianceByRegister.mockResolvedValue([]);
    getNoSaleCounts.mockResolvedValue([]);
    getRegisterHourly.mockResolvedValue([]);

    await reports.getSalesByLocation(RANGE, filter);
    await reports.getDrawerVarianceByRegister(RANGE, filter);
    await reports.getNoSaleCounts(RANGE, filter);
    await reports.getRegisterHourly(RANGE, 'r1');

    expect(getSalesByLocation).toHaveBeenCalledWith(RANGE, filter);
    expect(getDrawerVarianceByRegister).toHaveBeenCalledWith(RANGE, filter);
    expect(getNoSaleCounts).toHaveBeenCalledWith(RANGE, filter);
    expect(getRegisterHourly).toHaveBeenCalledWith(RANGE, 'r1');
  });
});

describe('getRegisterCapabilitySplit', () => {
  const RANGE = { from: 0, to: 1 };

  function register(overrides: Partial<Record<string, unknown>>) {
    return {
      registerId: 'r',
      displayCode: 'MAIN-01',
      name: 'Register',
      locationId: 'l1',
      locationName: 'Main',
      type: 'fixed',
      hasCashDrawer: true,
      status: 'active',
      orderCount: 1,
      gross: 10,
      discounts: 0,
      tax: 0,
      net: 10,
      ...overrides,
    };
  }

  it('classifies a web/no-drawer register separately from a fixed/drawer one', async () => {
    getSalesByRegister.mockResolvedValue([
      register({ registerId: 'fixed-1', type: 'fixed', hasCashDrawer: true, orderCount: 2, net: 20 }),
      register({ registerId: 'web-1', type: 'web', hasCashDrawer: false, orderCount: 5, net: 50 }),
    ]);

    const split = await reports.getRegisterCapabilitySplit(RANGE);

    expect(split.drawerCapable).toEqual({ registerCount: 1, orderCount: 2, net: 20 });
    expect(split.nonDrawerCapable).toEqual({ registerCount: 1, orderCount: 5, net: 50 });
  });

  it('sums net in cents so several rows do not drift in floating-point dollars', async () => {
    // 19.44 + 10.80 + 9.99 as naive JS float addition can land a fraction of a
    // cent off; composed in cents it must land exactly on 40.23.
    getSalesByRegister.mockResolvedValue([
      register({ registerId: 'a', hasCashDrawer: true, net: 19.44 }),
      register({ registerId: 'b', hasCashDrawer: true, net: 10.8 }),
      register({ registerId: 'c', hasCashDrawer: true, net: 9.99 }),
    ]);

    const split = await reports.getRegisterCapabilitySplit(RANGE);

    expect(split.drawerCapable.net).toBe(40.23);
  });

  it('returns zeroed buckets rather than nulls when nothing traded', async () => {
    getSalesByRegister.mockResolvedValue([]);

    const split = await reports.getRegisterCapabilitySplit(RANGE);

    expect(split).toEqual({
      drawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
      nonDrawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
    });
  });
});
