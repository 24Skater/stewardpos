import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * The register/cashier/location reporting aggregations added this phase,
 * against a real Postgres. `reports.integration.test.ts` already covers the
 * unfiltered totals this phase builds on; this file is about the new
 * `RegisterFilter`-narrowed aggregations and the properties specific to
 * them — retired registers not vanishing, cashier attribution surviving a
 * later shift, drawer variance, no-sale counts, and timezone-aware hourly
 * bucketing.
 *
 * Isolated in its own organisation rather than a date window nothing else
 * uses: unlike `reports.integration.test.ts`'s orders, registers and
 * locations are not date-scoped, so the only way to guarantee this file's
 * counts cannot be folded into another file's is to give every row here its
 * own org, following the pattern in `registerOverrides.integration.test.ts`.
 */
let h: Harness;
const mark = tag();

let orgId: string;
const userIds: string[] = [];
const locationIds: string[] = [];
const registerIds: string[] = [];
const orderIds: string[] = [];
const sessionIds: string[] = [];
const overrideIds: string[] = [];
const shiftIds: string[] = [];

let approverUserId: string;

let registerCounter = 0;
let overrideCounter = 0;

async function makeLocation(name: string, timezone = 'UTC'): Promise<string> {
  const slug = `${mark}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const location = await h.adapter.createLocation({
    org_id: orgId,
    name: `${mark} ${name}`,
    slug,
    timezone,
  });
  if (typeof location === 'string') throw new Error(`expected a location row, got ${location}`);
  const id = String(location.id);
  locationIds.push(id);
  return id;
}

async function makeRegister(
  locationId: string,
  opts: { type?: string; hasCashDrawer?: boolean; status?: string } = {}
): Promise<string> {
  registerCounter += 1;
  const register = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} register ${registerCounter}`,
    register_number: registerCounter,
    display_code: `${mark}-REG-${registerCounter}`,
    type: opts.type ?? 'fixed',
    has_cash_drawer: opts.hasCashDrawer ?? true,
    status: opts.status ?? 'active',
  });
  if (typeof register === 'string') throw new Error(`expected a register row, got ${register}`);
  const id = String(register.id);
  registerIds.push(id);
  return id;
}

async function makeUser(email: string): Promise<string> {
  const created = await h.adapter.createUser({
    email: `${mark}-${email}`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} ${email}`,
    status: 'active',
    roleIds: [],
  });
  const id = String(created.id);
  userIds.push(id);
  return id;
}

/**
 * Writes a bare order — no items, no payments — attributed to a register and
 * (optionally) a cashier, back-dated the same way `reports.integration.test.ts`
 * does: `createOrder` has no parameter for the date, so it is set with a
 * follow-up UPDATE.
 */
async function sale(spec: {
  registerId: string;
  cashierUserId?: string;
  amount: number;
  paymentMethod?: string;
  at: string;
}): Promise<string> {
  const order = await h.adapter.createOrder({
    items: [],
    subtotal: spec.amount,
    discountTotal: 0,
    taxTotal: 0,
    total: spec.amount,
    paymentMethod: spec.paymentMethod ?? 'Cash',
    registerId: spec.registerId,
    cashierUserId: spec.cashierUserId ?? null,
  });
  const id = String(order.id);
  await h.query('UPDATE orders SET created_at = $2 WHERE id = $1', [id, spec.at]);
  orderIds.push(id);
  return id;
}

/** Opens, closes and back-dates a drawer session in one call. */
async function drawerSession(
  registerId: string,
  countedCash: number,
  expectedCash: number,
  closedAt: string
): Promise<string> {
  const opened = await h.adapter.openDrawerSession({
    registerId,
    openingFloat: 100,
    userId: approverUserId,
  });
  const id = String(opened.id);
  sessionIds.push(id);
  await h.adapter.closeDrawerSession(id, countedCash, expectedCash, approverUserId);
  await h.query('UPDATE cash_drawer_sessions SET closed_at = $2 WHERE id = $1', [id, closedAt]);
  return id;
}

async function overrideGrant(registerId: string, action: string, at: string): Promise<string> {
  overrideCounter += 1;
  const created = await h.adapter.createRegisterOverride({
    registerId,
    shiftId: null,
    approverUserId,
    requestedByUserId: null,
    action,
    grantPrefix: `${mark}${overrideCounter}`,
    grantHash: 'not-a-real-hash',
    expiresAt: Date.now() + 90_000,
    reason: null,
  });
  const id = String(created.id);
  overrideIds.push(id);
  await h.query('UPDATE register_overrides SET created_at = $2 WHERE id = $1', [id, at]);
  return id;
}

beforeAll(async () => {
  h = await connect();

  const org = await h.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [
    `${mark} org`,
    `${mark}-org`,
  ]);
  orgId = String(org.rows[0].id);

  approverUserId = await makeUser('approver');
}, 30_000);

afterAll(async () => {
  // Dependency order: rows referencing registers/users first, then registers,
  // then locations, then users, then the organisation.
  if (registerIds.length > 0) {
    await h.query('DELETE FROM register_overrides WHERE register_id = ANY($1)', [registerIds]);
    await h.query('DELETE FROM cash_drawer_sessions WHERE register_id = ANY($1)', [registerIds]);
    await h.query('DELETE FROM register_shifts WHERE register_id = ANY($1)', [registerIds]);
  }
  if (orderIds.length > 0) {
    await h.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  }
  if (registerIds.length > 0) {
    await h.query('DELETE FROM registers WHERE id = ANY($1)', [registerIds]);
  }
  if (locationIds.length > 0) {
    await h.query('DELETE FROM locations WHERE id = ANY($1)', [locationIds]);
  }
  if (userIds.length > 0) {
    await h.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await h.close();
});

describe('getSalesByRegister', () => {
  it('sums, split by register, to the same figure as the unfiltered total for those registers', async () => {
    // Amounts chosen to expose rounding: three registers splitting $10.00
    // unevenly, at $3.33/$3.33/$3.34.
    const location = await makeLocation('split-by-register');
    const [r1, r2, r3] = await Promise.all([
      makeRegister(location),
      makeRegister(location),
      makeRegister(location),
    ]);
    const at = '2001-02-10T10:00:00.000Z';
    await sale({ registerId: r1, amount: 3.33, at });
    await sale({ registerId: r2, amount: 3.33, at });
    await sale({ registerId: r3, amount: 3.34, at });

    const range = {
      from: Date.parse('2001-02-10T00:00:00.000Z'),
      to: Date.parse('2001-02-10T23:59:59.999Z'),
    };
    const filter = { registerIds: [r1, r2, r3] };

    const byRegister = await h.adapter.getSalesByRegister(range, filter);
    const summedCents = byRegister.reduce((cents, row) => cents + Math.round(row.net * 100), 0);
    expect(summedCents).toBe(1000);

    const totals = await h.adapter.getSalesTotals(range, filter);
    expect(Math.round(totals.net * 100)).toBe(summedCents);
  });

  it('still shows a register that was retired after it traded', async () => {
    const location = await makeLocation('retired');
    const register = await makeRegister(location);
    const at = '2001-02-11T10:00:00.000Z';
    await sale({ registerId: register, amount: 25, at });

    await h.adapter.updateRegister(register, { status: 'retired' });

    const range = {
      from: Date.parse('2001-02-11T00:00:00.000Z'),
      to: Date.parse('2001-02-11T23:59:59.999Z'),
    };
    const rows = await h.adapter.getSalesByRegister(range, { registerIds: [register] });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('retired');
    expect(rows[0].net).toBe(25);
  });

  it('classifies a web/no-drawer register separately from a fixed/drawer one', async () => {
    const location = await makeLocation('capability-split');
    const web = await makeRegister(location, { type: 'web', hasCashDrawer: false });
    const fixed = await makeRegister(location, { type: 'fixed', hasCashDrawer: true });
    const at = '2001-02-12T10:00:00.000Z';
    await sale({ registerId: web, amount: 5, at });
    await sale({ registerId: fixed, amount: 7, at });

    const range = {
      from: Date.parse('2001-02-12T00:00:00.000Z'),
      to: Date.parse('2001-02-12T23:59:59.999Z'),
    };
    const rows = await h.adapter.getSalesByRegister(range, { registerIds: [web, fixed] });

    const webRow = rows.find((row) => row.registerId === web);
    const fixedRow = rows.find((row) => row.registerId === fixed);
    expect(webRow).toMatchObject({ type: 'web', hasCashDrawer: false });
    expect(fixedRow).toMatchObject({ type: 'fixed', hasCashDrawer: true });
  });

  it('filters by locationIds to only that location\'s registers', async () => {
    const locationA = await makeLocation('filter-a');
    const locationB = await makeLocation('filter-b');
    const registerA = await makeRegister(locationA);
    const registerB = await makeRegister(locationB);
    const at = '2001-02-13T10:00:00.000Z';
    await sale({ registerId: registerA, amount: 9, at });
    await sale({ registerId: registerB, amount: 11, at });

    const range = {
      from: Date.parse('2001-02-13T00:00:00.000Z'),
      to: Date.parse('2001-02-13T23:59:59.999Z'),
    };
    const rows = await h.adapter.getSalesByRegister(range, { locationIds: [locationA] });

    expect(rows.some((row) => row.registerId === registerA)).toBe(true);
    expect(rows.some((row) => row.registerId === registerB)).toBe(false);
    expect(rows.every((row) => row.locationId === locationA)).toBe(true);
  });

  it('treats an empty registerIds array as no filter, not a filter matching nothing', async () => {
    const location = await makeLocation('empty-array-filter');
    const register = await makeRegister(location);
    const at = '2001-02-14T10:00:00.000Z';
    await sale({ registerId: register, amount: 6, at });

    const range = {
      from: Date.parse('2001-02-14T00:00:00.000Z'),
      to: Date.parse('2001-02-14T23:59:59.999Z'),
    };
    const rows = await h.adapter.getSalesByRegister(range, { registerIds: [] });

    expect(rows.some((row) => row.registerId === register)).toBe(true);
  });

  it('returns an empty array, not null, for a range with nothing in it', async () => {
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getSalesByRegister(empty)).toEqual([]);
  });
});

describe('getSalesByCashier', () => {
  it('sums, split by cashier, to the same figure as the unfiltered total', async () => {
    const location = await makeLocation('split-by-cashier');
    const register = await makeRegister(location);
    const [cashierA, cashierB, cashierC] = await Promise.all([
      makeUser('cashier-a'),
      makeUser('cashier-b'),
      makeUser('cashier-c'),
    ]);
    const at = '2001-02-15T10:00:00.000Z';
    await sale({ registerId: register, cashierUserId: cashierA, amount: 3.33, at });
    await sale({ registerId: register, cashierUserId: cashierB, amount: 3.33, at });
    await sale({ registerId: register, cashierUserId: cashierC, amount: 3.34, at });

    const range = {
      from: Date.parse('2001-02-15T00:00:00.000Z'),
      to: Date.parse('2001-02-15T23:59:59.999Z'),
    };
    const filter = { registerIds: [register] };

    const byCashier = await h.adapter.getSalesByCashier(range, filter);
    const summedCents = byCashier.reduce((cents, row) => cents + Math.round(row.net * 100), 0);
    expect(summedCents).toBe(1000);

    const totals = await h.adapter.getSalesTotals(range, filter);
    expect(Math.round(totals.net * 100)).toBe(summedCents);
  });

  it('attributes a sale to the cashier who rang it, not whoever starts a shift on the register afterward', async () => {
    const location = await makeLocation('attribution');
    const register = await makeRegister(location);
    const cashierA = await makeUser('attrib-a');
    const cashierB = await makeUser('attrib-b');
    const at = '2001-02-16T10:00:00.000Z';

    await sale({ registerId: register, cashierUserId: cashierA, amount: 15, at });

    // B starts a shift on the SAME register after A's sale completed. A naive
    // report that joined orders to "whichever shift is open on this register
    // now" would repaint A's sale as B's.
    const shift = await h.adapter.createRegisterShift({ registerId: register, userId: cashierB });
    shiftIds.push(String(shift.id));

    const range = {
      from: Date.parse('2001-02-16T00:00:00.000Z'),
      to: Date.parse('2001-02-16T23:59:59.999Z'),
    };
    const byCashier = await h.adapter.getSalesByCashier(range, { registerIds: [register] });

    const rowA = byCashier.find((row) => row.cashierUserId === cashierA);
    const rowB = byCashier.find((row) => row.cashierUserId === cashierB);
    expect(rowA).toMatchObject({ orderCount: 1, net: 15 });
    expect(rowB).toBeUndefined();
  });

  it('returns an empty array for a range with nothing in it', async () => {
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getSalesByCashier(empty)).toEqual([]);
  });
});

describe('getSalesByLocation', () => {
  it('rolls sales up to the site and counts only registers that traded', async () => {
    const location = await makeLocation('rollup');
    const registerA = await makeRegister(location);
    const registerB = await makeRegister(location);
    const at = '2001-02-17T10:00:00.000Z';
    await sale({ registerId: registerA, amount: 12, at });
    await sale({ registerId: registerB, amount: 8, at });

    const range = {
      from: Date.parse('2001-02-17T00:00:00.000Z'),
      to: Date.parse('2001-02-17T23:59:59.999Z'),
    };
    const rows = await h.adapter.getSalesByLocation(range, {
      registerIds: [registerA, registerB],
    });

    expect(rows).toEqual([
      { locationId: location, locationName: `${mark} rollup`, registerCount: 2, orderCount: 2, net: 20 },
    ]);
  });

  it('returns an empty array for a range with nothing in it', async () => {
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getSalesByLocation(empty)).toEqual([]);
  });
});

describe('getDrawerVarianceByRegister', () => {
  it('reports sessionCount, totalVariance and shortCount for two short sessions and one over', async () => {
    const location = await makeLocation('drawer-variance');
    const register = await makeRegister(location);
    const closedAt = '2001-02-18T18:00:00.000Z';

    await drawerSession(register, 90, 100, closedAt); // -10, short
    await drawerSession(register, 95, 100, closedAt); // -5, short
    await drawerSession(register, 110, 100, closedAt); // +10, over

    const range = {
      from: Date.parse('2001-02-18T00:00:00.000Z'),
      to: Date.parse('2001-02-18T23:59:59.999Z'),
    };
    const rows = await h.adapter.getDrawerVarianceByRegister(range, { registerIds: [register] });

    expect(rows).toHaveLength(1);
    expect(rows[0].sessionCount).toBe(3);
    expect(rows[0].totalVariance).toBe(-5);
    expect(rows[0].worstVariance).toBe(-10);
    expect(rows[0].shortCount).toBe(2);
  });

  it('returns an empty array for a range with nothing in it', async () => {
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getDrawerVarianceByRegister(empty)).toEqual([]);
  });
});

describe('getNoSaleCounts', () => {
  it('counts only action = \'no_sale\' rows, not every override', async () => {
    const location = await makeLocation('no-sale');
    const register = await makeRegister(location);
    const at = '2001-02-19T10:00:00.000Z';

    await overrideGrant(register, 'no_sale', at);
    await overrideGrant(register, 'no_sale', at);
    await overrideGrant(register, 'void', at);

    const range = {
      from: Date.parse('2001-02-19T00:00:00.000Z'),
      to: Date.parse('2001-02-19T23:59:59.999Z'),
    };
    const rows = await h.adapter.getNoSaleCounts(range, { registerIds: [register] });

    expect(rows).toEqual([
      {
        registerId: register,
        displayCode: expect.stringContaining('REG-'),
        name: expect.stringContaining('register'),
        noSaleCount: 2,
      },
    ]);
  });

  it('returns an empty array for a range with nothing in it', async () => {
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getNoSaleCounts(empty)).toEqual([]);
  });
});

describe('getRegisterHourly', () => {
  it('buckets by the local hour of a non-UTC location, not the UTC hour', async () => {
    // 06:30 UTC on the 10th is 22:30 the *previous* evening in
    // America/Los_Angeles (UTC-8, no DST in February): a day-boundary case
    // where the naive, UTC-hour answer (6) and the correct local answer (22)
    // could not disagree more.
    const location = await makeLocation('hourly-tz', 'America/Los_Angeles');
    const register = await makeRegister(location);
    await sale({ registerId: register, amount: 12, at: '2001-02-10T06:30:00.000Z' });

    const range = {
      from: Date.parse('2001-02-09T00:00:00.000Z'),
      to: Date.parse('2001-02-11T00:00:00.000Z'),
    };
    const hourly = await h.adapter.getRegisterHourly(range, register);

    expect(hourly).toEqual([{ hour: 22, orderCount: 1, net: 12 }]);
  });

  it('returns an empty array for a range with nothing in it', async () => {
    const location = await makeLocation('hourly-empty');
    const register = await makeRegister(location);
    const empty = {
      from: Date.parse('1990-01-01T00:00:00.000Z'),
      to: Date.parse('1990-01-02T00:00:00.000Z'),
    };

    expect(await h.adapter.getRegisterHourly(empty, register)).toEqual([]);
  });
});
