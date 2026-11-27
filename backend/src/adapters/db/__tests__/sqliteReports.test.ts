import { beforeEach, expect, it } from 'vitest';
import {
  backdate,
  DEFAULT_ORG,
  describeSqlite,
  MAIN_LOCATION,
  MAIN_REGISTER,
  seedProduct,
  seedUser,
  useFreshSqlite,
} from './sqliteHarness';

/**
 * The register-aware reports on SQLite: sales by register, cashier and
 * location, drawer variance, no-sale counts, hourly trading, and the
 * RegisterFilter threaded through the summary reports. Mirrors the Postgres
 * reports and registerReports suites.
 *
 * Everything is back-dated into January 2001, so the window is fixed and the
 * epoch-millisecond range predicates are what is under test.
 */

const RANGE = { from: Date.parse('2001-01-01T00:00:00.000Z'), to: Date.parse('2001-01-31T23:59:59.999Z') };
const EMPTY = { from: 0, to: 1 };
const at = (iso: string) => Date.parse(iso);

describeSqlite('register reports on SQLite', () => {
  const h = useFreshSqlite();
  const ids = {} as Record<'annex' | 'web' | 'casey' | 'drew' | 'product' | 'variant', string>;

  beforeEach(async () => {
    const annex = await h.adapter.createLocation({ org_id: DEFAULT_ORG, name: 'Annex', slug: 'annex', timezone: 'America/New_York' });
    ids.annex = String((annex as Record<string, unknown>).id);
    const web = await h.adapter.createRegister({
      org_id: DEFAULT_ORG, location_id: ids.annex, name: 'Web', register_number: 1, display_code: 'ANNEX-01', type: 'web', has_cash_drawer: false,
    });
    ids.web = String((web as Record<string, unknown>).id);
    ids.casey = await seedUser(h.adapter, 'casey@example.com', 'Casey');
    ids.drew = await seedUser(h.adapter, 'drew@example.com', 'Drew');
    const seeded = await seedProduct(h.adapter, 'Beans', 100);
    ids.product = seeded.productId;
    ids.variant = seeded.variantId;

    const sale = async (when: string, total: number, registerId: string | null, cashierUserId: string | null, extra = {}) => {
      const order = await h.adapter.createOrder({
        items: [{ productId: ids.product, variantId: ids.variant, nameSnapshot: 'Beans', quantity: 1, unitPrice: total, lineTotal: total }],
        subtotal: total, discountTotal: 0, taxTotal: 0, total, paymentMethod: 'Cash', registerId, cashierUserId,
        payments: [{ method: 'cash', amount: total }],
        ...extra,
      });
      backdate(h.db, 'orders', String(order.id), at(when));
      return order;
    };

    // MAIN-01: two sales by Casey. ANNEX-01: one by Drew at 09:30 New York time. One pre-register sale.
    await sale('2001-01-10T10:00:00.000Z', 10.1, MAIN_REGISTER, ids.casey);
    await sale('2001-01-10T11:00:00.000Z', 20.2, MAIN_REGISTER, ids.casey);
    await sale('2001-01-11T14:30:00.000Z', 5.05, ids.web, ids.drew);
    await sale('2001-01-12T10:00:00.000Z', 1, null, null);
    // Outside the window.
    await sale('2002-06-01T10:00:00.000Z', 999, MAIN_REGISTER, ids.casey);
  });

  it('splits sales by register, still showing a retired register that traded', async () => {
    await h.adapter.setRegisterStatus(ids.web, 'retired');

    const rows = await h.adapter.getSalesByRegister(RANGE);

    expect(rows.map((r) => [r.displayCode, r.orderCount, r.net, r.status, r.hasCashDrawer])).toEqual([
      ['ANNEX-01', 1, 5.05, 'retired', false],
      ['MAIN-01', 2, 30.3, 'active', true],
    ]);
    expect(await h.adapter.getSalesByRegister(EMPTY)).toEqual([]);
  });

  it('filters by location and register ids, treating an empty array as no filter', async () => {
    expect((await h.adapter.getSalesByRegister(RANGE, { locationIds: [ids.annex] })).map((r) => r.registerId)).toEqual([ids.web]);
    expect((await h.adapter.getSalesByRegister(RANGE, { registerIds: [MAIN_REGISTER] })).map((r) => r.registerId)).toEqual([MAIN_REGISTER]);
    expect(await h.adapter.getSalesByRegister(RANGE, { registerIds: [] })).toHaveLength(2);
    expect(await h.adapter.getSalesTotals(RANGE, { registerIds: [MAIN_REGISTER], cashierUserIds: [ids.casey] })).toMatchObject({ orderCount: 2, net: 30.3 });
    expect(await h.adapter.getSalesTotals(RANGE, { locationIds: [MAIN_LOCATION] })).toMatchObject({ orderCount: 2 });
  });

  it('threads the filter through the summary reports', async () => {
    const filter = { registerIds: [ids.web] };

    expect(await h.adapter.getSalesByDay(RANGE, filter)).toEqual([{ date: '2001-01-11', orderCount: 1, gross: 5.05, net: 5.05 }]);
    expect(await h.adapter.getTopProducts(RANGE, 5, filter)).toEqual([{ productId: ids.product, name: 'Beans', quantity: 1, revenue: 5.05 }]);
    expect(await h.adapter.getPaymentMix(RANGE, filter)).toEqual([{ method: 'cash', count: 1, amount: 5.05 }]);
    expect(await h.adapter.getReturnsTotals(RANGE, filter)).toEqual({ returnCount: 0, refunded: 0, pendingCount: 0, pendingAmount: 0 });
    expect(await h.adapter.getReturnsByReason(RANGE, filter)).toEqual([]);
  });

  it('splits sales by cashier, with pre-sign-in sales in an Unknown bucket so the total reconciles', async () => {
    const rows = await h.adapter.getSalesByCashier(RANGE);
    const totals = await h.adapter.getSalesTotals(RANGE);

    expect(rows.map((r) => [r.cashierName, r.orderCount, r.net])).toEqual([
      ['Casey', 2, 30.3],
      ['Drew', 1, 5.05],
      ['Unknown', 1, 1],
    ]);
    expect(rows.reduce((sum, r) => sum + r.net, 0)).toBeCloseTo(totals.net, 2);
    expect(await h.adapter.getSalesByCashier(RANGE, { cashierUserIds: [ids.drew] })).toHaveLength(1);
    expect(await h.adapter.getSalesByCashier(EMPTY)).toEqual([]);
  });

  it('rolls sales up to the location, counting only registers that traded', async () => {
    const rows = await h.adapter.getSalesByLocation(RANGE);

    expect(rows.map((r) => [r.locationName, r.registerCount, r.orderCount, r.net])).toEqual([
      ['Annex', 1, 1, 5.05],
      ['Main Location', 1, 2, 30.3],
    ]);
    expect((await h.adapter.getSalesByLocation(RANGE, { registerIds: [MAIN_REGISTER] })).map((r) => r.locationId)).toEqual([MAIN_LOCATION]);
    expect(await h.adapter.getSalesByLocation(EMPTY)).toEqual([]);
  });

  it('buckets a register’s trading by its location’s local hour, not the UTC hour', async () => {
    const hourly = await h.adapter.getRegisterHourly(RANGE, ids.web);

    // 14:30 UTC is 09:30 in New York in January (UTC-5).
    expect(hourly).toEqual([expect.objectContaining({ hour: 9, orderCount: 1, net: 5.05 })]);
    expect(await h.adapter.getRegisterHourly(EMPTY, ids.web)).toEqual([]);
  });

  it('reports drawer variance from closed sessions in range', async () => {
    const short1 = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 0 });
    await h.adapter.closeDrawerSession(String(short1.id), 95, 100);
    const short2 = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 0 });
    await h.adapter.closeDrawerSession(String(short2.id), 48.5, 50);
    const over = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 0 });
    await h.adapter.closeDrawerSession(String(over.id), 21, 20);
    await h.adapter.openDrawerSession({ registerId: ids.web, openingFloat: 0 });
    for (const s of [short1, short2, over]) backdate(h.db, 'cash_drawer_sessions', String(s.id), at('2001-01-15T18:00:00.000Z'), 'closed_at');

    expect(await h.adapter.getDrawerVarianceByRegister(RANGE)).toEqual([
      { registerId: MAIN_REGISTER, displayCode: 'MAIN-01', name: 'Register 1', sessionCount: 3, totalVariance: -5.5, worstVariance: -5, shortCount: 2 },
    ]);
    expect(await h.adapter.getDrawerVarianceByRegister(RANGE, { registerIds: [ids.web] })).toEqual([]);
    expect(await h.adapter.getDrawerVarianceByRegister(EMPTY)).toEqual([]);
  });

  it('counts only no-sale overrides', async () => {
    const grant = (action: string, prefix: string) =>
      h.adapter.createRegisterOverride({
        registerId: MAIN_REGISTER, shiftId: null, approverUserId: ids.drew, requestedByUserId: ids.casey, action,
        grantPrefix: prefix, grantHash: 'h', expiresAt: 0, reason: null,
      });
    const a = await grant('no_sale', 'P1');
    const b = await grant('no_sale', 'P2');
    const c = await grant('void', 'P3');
    for (const o of [a, b, c]) backdate(h.db, 'register_overrides', String(o.id), at('2001-01-20T12:00:00.000Z'));

    expect(await h.adapter.getNoSaleCounts(RANGE)).toEqual([{ registerId: MAIN_REGISTER, displayCode: 'MAIN-01', name: 'Register 1', noSaleCount: 2 }]);
    expect(await h.adapter.getNoSaleCounts(RANGE, { cashierUserIds: [ids.drew] })).toEqual([]);
    expect(await h.adapter.getNoSaleCounts(EMPTY)).toEqual([]);
  });

  it('breaks completed refunds down by reason, labelling a missing reason', async () => {
    const order = (await h.adapter.getAllOrders())[0];
    const ret = (reasonCode: string | undefined, status: string, total: number) =>
      h.adapter.createReturn({ originalOrderId: order.id, returnNumber: `R-${Math.random()}`, status, subtotal: total, total, reasonCode, registerId: MAIN_REGISTER });
    const rows = [await ret('damaged', 'completed', 4), await ret(undefined, 'completed', 1.5), await ret('damaged', 'pending', 2)];
    for (const r of rows) backdate(h.db, 'returns', String(r.id), at('2001-01-21T12:00:00.000Z'));

    expect(await h.adapter.getReturnsTotals(RANGE)).toEqual({ returnCount: 2, refunded: 5.5, pendingCount: 1, pendingAmount: 2 });
    expect(await h.adapter.getReturnsByReason(RANGE)).toEqual([
      { reasonCode: 'damaged', returnCount: 1, refunded: 4 },
      { reasonCode: 'unspecified', returnCount: 1, refunded: 1.5 },
    ]);
  });
});
