import { expect, it } from 'vitest';
import {
  DEFAULT_ORG,
  describeSqlite,
  MAIN_LOCATION,
  MAIN_REGISTER,
  seedOrg,
  seedUser,
  useFreshSqlite,
} from './sqliteHarness';
import type { SqliteHarness } from './sqliteHarness';

/**
 * Locations, registers, device credentials, shifts, manager overrides and cash
 * drawer sessions on SQLite. Mirrors the Postgres registers,
 * registerCredentials, registerOverrides, pinsAndShifts and money suites —
 * including org isolation, which these tables are the tenancy boundary for.
 */

const ORG_B = '00000000-0000-0000-0000-0000000000e2';

async function location(h: SqliteHarness, orgId: string, slug: string) {
  const created = await h.adapter.createLocation({ org_id: orgId, name: `Loc ${slug}`, slug });
  if (created === 'duplicate_slug') throw new Error('unexpected duplicate');
  return String(created.id);
}

async function register(h: SqliteHarness, orgId: string, locationId: string, n: number, extra: Record<string, unknown> = {}) {
  const created = await h.adapter.createRegister({
    org_id: orgId, location_id: locationId, name: `Till ${n}`, register_number: n, display_code: `T-${n}`, ...extra,
  });
  if (typeof created === 'string') throw new Error(created);
  return String(created.id);
}

describeSqlite('locations on SQLite', () => {
  const h = useFreshSqlite();

  it('creates a location with defaults, and refuses a duplicate slug only within the same org', async () => {
    seedOrg(h.db, ORG_B, 'orgb');

    const created = await h.adapter.createLocation({ org_id: DEFAULT_ORG, name: 'Annex', slug: 'annex', city: 'Leeds' });

    expect(created).toMatchObject({ orgId: DEFAULT_ORG, timezone: 'UTC', status: 'active', city: 'Leeds', address: null });
    expect(await h.adapter.createLocation({ org_id: DEFAULT_ORG, name: 'Dup', slug: 'annex' })).toBe('duplicate_slug');
    expect(await h.adapter.createLocation({ org_id: ORG_B, name: 'Theirs', slug: 'annex' })).toMatchObject({ orgId: ORG_B });
  });

  it('lists only the org’s own locations, active first, with non-retired register counts', async () => {
    seedOrg(h.db, ORG_B, 'orgb');
    const retired = await location(h, DEFAULT_ORG, 'old');
    await h.adapter.updateLocation(retired, { status: 'retired' });
    await location(h, ORG_B, 'theirs');
    const r = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2);
    await h.adapter.setRegisterStatus(r, 'retired');

    const mine = await h.adapter.getLocations(DEFAULT_ORG);

    expect(mine.map((l) => [l.slug, l.status, l.registerCount])).toEqual([
      ['main', 'active', 1],
      ['old', 'retired', 0],
    ]);
    expect((await h.adapter.getLocations(ORG_B)).map((l) => l.slug)).toEqual(['theirs']);
  });

  it('clears address on explicit null, leaves omitted keys alone, and skips a null NOT NULL column', async () => {
    const id = await location(h, DEFAULT_ORG, 'annex');
    await h.adapter.updateLocation(id, { address: '1 High St', zip: 'AB1' });

    const updated = await h.adapter.updateLocation(id, { address: null, name: null, timezone: 'Europe/London', city: 'York', state: 'NY' });

    expect(updated).toMatchObject({ address: null, zip: 'AB1', name: 'Loc annex', timezone: 'Europe/London', city: 'York', state: 'NY' });
    expect(await h.adapter.updateLocation(id, {})).toMatchObject({ zip: 'AB1' });
    expect(await h.adapter.getLocationById(id)).toMatchObject({ city: 'York' });
    expect(await h.adapter.getLocationById('missing')).toBeNull();
    expect(await h.adapter.updateLocation('missing', { name: 'x' })).toBeNull();
  });

  it('refuses a slug change onto a sibling’s slug, but allows keeping its own', async () => {
    const a = await location(h, DEFAULT_ORG, 'a');
    await location(h, DEFAULT_ORG, 'b');

    expect(await h.adapter.updateLocation(a, { slug: 'b' })).toBe('duplicate_slug');
    expect(await h.adapter.updateLocation(a, { slug: 'a', name: 'Same' })).toMatchObject({ slug: 'a', name: 'Same' });
    expect(await h.adapter.updateLocation(a, { slug: 'c' })).toMatchObject({ slug: 'c' });
  });
});

describeSqlite('registers on SQLite', () => {
  const h = useFreshSqlite();

  it('gives a minimally specified register a capable, pending posture with real booleans', async () => {
    const created = await h.adapter.createRegister({
      org_id: DEFAULT_ORG, location_id: MAIN_LOCATION, name: 'Till 2', register_number: 2, display_code: 'MAIN-02',
    });

    expect(created).toMatchObject({
      status: 'pending', type: 'fixed', hasCashDrawer: true, acceptsCash: true, canRefund: true,
      canOpenDrawerNoSale: false, requireSignIn: false, idleLockSeconds: 300, lastSeenAt: null,
    });
  });

  it('refuses a duplicate number per location, a duplicate code per org, and a location from another org', async () => {
    seedOrg(h.db, ORG_B, 'orgb');
    const theirLocation = await location(h, ORG_B, 'b');
    const sibling = await location(h, DEFAULT_ORG, 'sib');

    const base = { org_id: DEFAULT_ORG, name: 'X', type: 'web', has_cash_drawer: false };
    expect(await h.adapter.createRegister({ ...base, location_id: MAIN_LOCATION, register_number: 1, display_code: 'NEW' })).toBe('duplicate_number');
    expect(await h.adapter.createRegister({ ...base, location_id: sibling, register_number: 1, display_code: 'MAIN-01' })).toBe('duplicate_code');
    expect(await h.adapter.createRegister({ ...base, location_id: theirLocation, register_number: 9, display_code: 'Z' })).toBe('bad_location');
    expect(await h.adapter.createRegister({ ...base, location_id: 'missing', register_number: 9, display_code: 'Z' })).toBe('bad_location');
    expect(await h.adapter.createRegister({ ...base, org_id: ORG_B, location_id: theirLocation, register_number: 1, display_code: 'MAIN-01' })).toMatchObject({ orgId: ORG_B });
  });

  it('lists only the org’s registers, filtered by location and status, with the location named', async () => {
    seedOrg(h.db, ORG_B, 'orgb');
    const sibling = await location(h, DEFAULT_ORG, 'sib');
    const r2 = await register(h, DEFAULT_ORG, sibling, 1);
    await register(h, ORG_B, await location(h, ORG_B, 'b'), 1);

    // Ordered by location name: 'Loc sib' sorts before 'Main Location'.
    expect((await h.adapter.getRegisters({ orgId: DEFAULT_ORG })).map((r) => r.id)).toEqual([r2, MAIN_REGISTER]);
    expect((await h.adapter.getRegisters({ orgId: DEFAULT_ORG, locationId: sibling }))[0]).toMatchObject({ id: r2, locationName: 'Loc sib' });
    expect((await h.adapter.getRegisters({ orgId: DEFAULT_ORG, status: 'active' })).map((r) => r.id)).toEqual([MAIN_REGISTER]);
    expect(await h.adapter.getRegisterById(MAIN_REGISTER)).toMatchObject({ displayCode: 'MAIN-01', locationName: 'Main Location' });
    expect(await h.adapter.getRegisterById('missing')).toBeNull();
  });

  it('updates flags and clears the reader binding on explicit null, ignoring org, location and number', async () => {
    const id = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2, { terminal_provider: 'stripe', terminal_device_id: 'tmr_1', placement: 'Front' });

    const updated = await h.adapter.updateRegister(id, {
      terminal_provider: null, terminal_device_id: null, name: null, org_id: 'x', location_id: 'y', register_number: 99,
      type: 'mobile', status: 'active', idle_lock_seconds: 60, has_cash_drawer: false, accepts_cash: false,
      can_refund: false, can_open_drawer_no_sale: true, require_sign_in: true,
    });

    expect(updated).toMatchObject({
      terminalProvider: null, terminalDeviceId: null, placement: 'Front', name: 'Till 2', orgId: DEFAULT_ORG,
      locationId: MAIN_LOCATION, registerNumber: 2, type: 'mobile', status: 'active', idleLockSeconds: 60,
      hasCashDrawer: false, acceptsCash: false, canRefund: false, canOpenDrawerNoSale: true, requireSignIn: true,
    });
    expect(await h.adapter.updateRegister(id, { placement: null })).toMatchObject({ placement: null });
    expect(await h.adapter.updateRegister(id, {})).toMatchObject({ name: 'Till 2' });
    expect(await h.adapter.updateRegister('missing', { name: 'x' })).toBeNull();
  });

  it('refuses a display code another register in the org holds', async () => {
    const id = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2);

    expect(await h.adapter.updateRegister(id, { display_code: 'MAIN-01' })).toBe('duplicate_code');
    expect(await h.adapter.updateRegister(id, { display_code: 'T-2' })).toMatchObject({ displayCode: 'T-2' });
    expect(await h.adapter.updateRegister(id, { display_code: 'MAIN-09' })).toMatchObject({ displayCode: 'MAIN-09' });
  });

  it('counts pending, active and disabled toward the cap but not retired, and never releases a number', async () => {
    const pending = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2);
    const disabled = await register(h, DEFAULT_ORG, MAIN_LOCATION, 3);
    const retired = await register(h, DEFAULT_ORG, MAIN_LOCATION, 4);
    await h.adapter.setRegisterStatus(disabled, 'disabled');
    await h.adapter.setRegisterStatus(retired, 'retired');

    expect(await h.adapter.countRegistersForCap(DEFAULT_ORG)).toBe(3);
    expect(await h.adapter.getUsedRegisterNumbers(MAIN_LOCATION)).toEqual([1, 2, 3, 4]);
    expect(await h.adapter.setRegisterStatus('missing', 'active')).toBeNull();
    expect(pending).toBeTruthy();
  });

  it('stamps a heartbeat, and reports a missing register as null', async () => {
    expect((await h.adapter.touchRegisterLastSeen(MAIN_REGISTER))!.lastSeenAt).toEqual(expect.any(Number));
    expect(await h.adapter.touchRegisterLastSeen('missing')).toBeNull();
  });

  it('reads org policy and the drawer variance threshold', async () => {
    h.db.prepare('UPDATE organizations SET max_registers = 3, drawer_variance_threshold_cents = 525 WHERE id = ?').run(DEFAULT_ORG);
    seedOrg(h.db, ORG_B, 'orgb');

    expect(await h.adapter.getOrgPolicy(DEFAULT_ORG)).toEqual({ maxRegisters: 3, pinLength: 6 });
    expect(await h.adapter.getOrgPolicy(ORG_B)).toEqual({ maxRegisters: null, pinLength: 6 });
    expect(await h.adapter.getOrgPolicy('missing')).toBeNull();
    expect(await h.adapter.getOrganizationDrawerVarianceThreshold(DEFAULT_ORG)).toBe(5.25);
    expect(await h.adapter.getOrganizationDrawerVarianceThreshold(ORG_B)).toBeNull();
    expect(await h.adapter.getOrganizationDrawerVarianceThreshold('missing')).toBeNull();
  });
});

describeSqlite('register credentials on SQLite', () => {
  const h = useFreshSqlite();

  const pairing = (registerId: string, prefix = 'ABCD') => ({
    registerId, pairingCodePrefix: prefix, pairingCodeHash: 'pair-hash', pairingExpiresAt: Date.now() + 60_000, createdBy: null,
  });

  it('mints a pairing code, redeems it once, and lets an enrolled credential coexist with a new pairing code', async () => {
    const pair = await h.adapter.createPairingCredential(pairing(MAIN_REGISTER));

    expect(await h.adapter.getLiveUnredeemedPairingCredential(MAIN_REGISTER)).toMatchObject({ id: pair.id, tokenHash: null, enrolledAt: null });
    expect((await h.adapter.getPairingCredentialsByPrefix('ABCD')).map((c) => c.id)).toEqual([pair.id]);

    const redeemed = await h.adapter.redeemPairingCredential(String(pair.id), { tokenPrefix: 'tok1', tokenHash: 'tok-hash', enrolledAt: 10 });
    expect(redeemed).toMatchObject({ tokenPrefix: 'tok1', enrolledAt: 10 });
    expect(await h.adapter.redeemPairingCredential(String(pair.id), { tokenPrefix: 'tok2', tokenHash: 'x', enrolledAt: 11 })).toBeNull();

    const next = await h.adapter.createPairingCredential(pairing(MAIN_REGISTER, 'EFGH'));
    expect(await h.adapter.getLiveEnrolledCredential(MAIN_REGISTER)).toMatchObject({ id: pair.id });
    expect((await h.adapter.getLiveRegisterCredentials(MAIN_REGISTER)).map((c) => c.id).sort()).toEqual([pair.id, next.id].sort());
    expect((await h.adapter.getRegisterCredentialsByTokenPrefix('tok1')).map((c) => c.id)).toEqual([pair.id]);
  });

  it('refuses a second outstanding pairing code for one register', async () => {
    await h.adapter.createPairingCredential(pairing(MAIN_REGISTER));

    await expect(h.adapter.createPairingCredential(pairing(MAIN_REGISTER, 'WXYZ'))).rejects.toThrow('Failed to create pairing credential');
  });

  it('revokes once, recording who and why, and stamps last use', async () => {
    const admin = await seedUser(h.adapter, 'admin@example.com');
    const pair = await h.adapter.createPairingCredential(pairing(MAIN_REGISTER));
    const id = String(pair.id);

    await h.adapter.touchRegisterCredentialLastUsed(id);
    const revoked = await h.adapter.revokeRegisterCredentialById(id, { revokedBy: admin, reason: 'lost tablet' });

    expect(revoked).toMatchObject({ revokedBy: admin, revokeReason: 'lost tablet', lastUsedAt: expect.any(Number) });
    expect(await h.adapter.revokeRegisterCredentialById(id, { revokedBy: admin, reason: 'again' })).toBeNull();
    expect(await h.adapter.getLiveUnredeemedPairingCredential(MAIN_REGISTER)).toBeNull();
    expect(await h.adapter.getLiveEnrolledCredential(MAIN_REGISTER)).toBeNull();
    expect(await h.adapter.redeemPairingCredential(id, { tokenPrefix: 't', tokenHash: 'h', enrolledAt: 1 })).toBeNull();
  });
});

describeSqlite('register shifts on SQLite', () => {
  const h = useFreshSqlite();

  it('opens, touches and ends a shift, and ending it twice is a no-op', async () => {
    const cashier = await seedUser(h.adapter, 'cash@example.com');
    const shift = await h.adapter.createRegisterShift({ registerId: MAIN_REGISTER, userId: cashier });
    const id = String(shift.id);

    expect(await h.adapter.getOpenShiftForRegister(MAIN_REGISTER)).toMatchObject({ id, endedAt: null, emulatedUserId: null });
    expect(await h.adapter.touchRegisterShiftActivity(id)).toMatchObject({ id });

    expect(await h.adapter.endRegisterShift(id, 'signed_out')).toMatchObject({ endReason: 'signed_out', endedAt: expect.any(Number) });
    expect(await h.adapter.endRegisterShift(id, 'forced')).toBeNull();
    expect(await h.adapter.touchRegisterShiftActivity(id)).toBeNull();
    expect(await h.adapter.getOpenShiftForRegister(MAIN_REGISTER)).toBeNull();
    expect(await h.adapter.getRegisterShiftById(id)).toMatchObject({ endReason: 'signed_out' });
    expect(await h.adapter.getRegisterShiftById('missing')).toBeNull();
  });

  it('refuses a second open shift on the same register', async () => {
    const a = await seedUser(h.adapter, 'a@example.com');
    const b = await seedUser(h.adapter, 'b@example.com');
    await h.adapter.createRegisterShift({ registerId: MAIN_REGISTER, userId: a });

    await expect(h.adapter.createRegisterShift({ registerId: MAIN_REGISTER, userId: b })).rejects.toThrow('Failed to start shift');
  });

  it('lists the org’s shifts with names, filters, and pages, hiding another org’s roster', async () => {
    seedOrg(h.db, ORG_B, 'orgb');
    const theirRegister = await register(h, ORG_B, await location(h, ORG_B, 'b'), 1);
    const admin = await seedUser(h.adapter, 'admin@example.com', 'Admin');
    const cashier = await seedUser(h.adapter, 'cash@example.com', 'Casey');
    const covered = await h.adapter.createRegisterShift({ registerId: MAIN_REGISTER, userId: admin, emulatedUserId: cashier });
    await h.adapter.endRegisterShift(String(covered.id), 'signed_out');
    h.db.prepare('UPDATE register_shifts SET started_at = ? WHERE id = ?').run(1_000, covered.id);
    const open = await h.adapter.createRegisterShift({ registerId: MAIN_REGISTER, userId: cashier });
    await h.adapter.createRegisterShift({ registerId: theirRegister, userId: cashier });

    const all = await h.adapter.getRegisterShifts({ orgId: DEFAULT_ORG, limit: 10, offset: 0 });
    const page = await h.adapter.getRegisterShifts({ orgId: DEFAULT_ORG, limit: 1, offset: 1, registerId: MAIN_REGISTER, locationId: MAIN_LOCATION });

    expect(all.total).toBe(2);
    expect(all.shifts.map((s) => s.id)).toEqual([open.id, covered.id]);
    expect(all.shifts[1]).toMatchObject({ cashierName: 'Admin', emulatedUserName: 'Casey', registerDisplayCode: 'MAIN-01', locationName: 'Main Location' });
    expect(page).toMatchObject({ total: 2, shifts: [expect.objectContaining({ id: covered.id })] });
    expect((await h.adapter.getRegisterShifts({ orgId: DEFAULT_ORG, limit: 10, offset: 0, openOnly: true })).shifts.map((s) => s.id)).toEqual([open.id]);
    expect((await h.adapter.getRegisterShifts({ orgId: DEFAULT_ORG, limit: 10, offset: 0, userId: admin })).total).toBe(1);
    expect((await h.adapter.getRegisterShifts({ orgId: DEFAULT_ORG, limit: 10, offset: 0, from: 500, to: 1_500 })).shifts.map((s) => s.id)).toEqual([covered.id]);
    expect((await h.adapter.getRegisterShifts({ orgId: ORG_B, limit: 10, offset: 0 })).total).toBe(1);
  });
});

describeSqlite('manager overrides on SQLite', () => {
  const h = useFreshSqlite();

  const grant = (registerId: string, approverUserId: string, action = 'void', prefix = 'GRANT001') => ({
    registerId, shiftId: null, approverUserId, requestedByUserId: null, action, grantPrefix: prefix,
    grantHash: 'grant-hash', expiresAt: Date.now() + 60_000, reason: 'customer changed mind',
  });

  it('round-trips a grant and consumes it exactly once', async () => {
    const mgr = await seedUser(h.adapter, 'mgr@example.com');
    const created = await h.adapter.createRegisterOverride(grant(MAIN_REGISTER, mgr));
    const id = String(created.id);

    expect(created).toMatchObject({ grantHash: 'grant-hash', consumedAt: null, expiresAt: expect.any(Number) });
    expect((await h.adapter.getRegisterOverridesByPrefix('GRANT001')).map((o) => o.id)).toEqual([id]);

    const consumed = await h.adapter.consumeRegisterOverride(id, { entity: 'order', entityId: 'o1', beforeValue: '10', afterValue: '0' });
    expect(consumed).toMatchObject({ consumedAt: expect.any(Number), entity: 'order', entityId: 'o1', afterValue: '0' });
    expect(await h.adapter.consumeRegisterOverride(id, { entity: null, entityId: null, beforeValue: null, afterValue: null })).toBeNull();
  });

  it('wraps a grant for an unknown register as a DatabaseError', async () => {
    const mgr = await seedUser(h.adapter, 'mgr@example.com');

    await expect(h.adapter.createRegisterOverride(grant('missing', mgr))).rejects.toThrow('Failed to create override grant');
  });

  it('lists only the org’s grants, filters by register and approver, and never carries the hash', async () => {
    seedOrg(h.db, ORG_B, 'orgb');
    const theirRegister = await register(h, ORG_B, await location(h, ORG_B, 'b'), 1);
    const mgr = await seedUser(h.adapter, 'mgr@example.com', 'Manager');
    const other = await seedUser(h.adapter, 'other@example.com', 'Other');
    await h.adapter.createRegisterOverride(grant(MAIN_REGISTER, mgr));
    await h.adapter.createRegisterOverride(grant(MAIN_REGISTER, other, 'no_sale', 'GRANT002'));
    await h.adapter.createRegisterOverride(grant(theirRegister, mgr, 'void', 'GRANT003'));

    const mine = await h.adapter.getRegisterOverrides({ orgId: DEFAULT_ORG, limit: 10, offset: 0 });
    const byApprover = await h.adapter.getRegisterOverrides({ orgId: DEFAULT_ORG, limit: 10, offset: 0, registerId: MAIN_REGISTER, approverUserId: mgr });

    expect(mine.total).toBe(2);
    expect(JSON.stringify(mine)).not.toContain('grant-hash');
    expect(byApprover).toMatchObject({ total: 1, overrides: [expect.objectContaining({ grantPrefix: 'GRANT001' })] });
    expect((await h.adapter.getRegisterOverrides({ orgId: ORG_B, limit: 10, offset: 0 })).total).toBe(1);
  });
});

describeSqlite('cash drawer sessions on SQLite', () => {
  const h = useFreshSqlite();

  it('opens one session per register, and lets a second register hold its own', async () => {
    const other = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2);
    const opener = await seedUser(h.adapter, 'open@example.com', 'Opener');

    const session = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 100, userId: opener });

    expect(session).toMatchObject({ status: 'open', openingFloat: 100, registerId: MAIN_REGISTER });
    await expect(h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 50 })).rejects.toThrow('already has a drawer session open');
    expect(await h.adapter.openDrawerSession({ registerId: other, openingFloat: 50 })).toMatchObject({ registerId: other });
    expect(await h.adapter.getOpenDrawerSession(MAIN_REGISTER)).toMatchObject({ id: session.id, openedByName: 'Opener', registerDisplayCode: 'MAIN-01' });
  });

  it('expects float plus cash taken less change, attributed by session rather than time', async () => {
    const other = await register(h, DEFAULT_ORG, MAIN_LOCATION, 2);
    const mine = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 100 });
    const theirs = await h.adapter.openDrawerSession({ registerId: other, openingFloat: 0 });
    const sale = { subtotal: 10, total: 10, paymentMethod: 'Cash' };
    await h.adapter.createOrder({ ...sale, drawerSessionId: mine.id, amountTendered: 20, changeGiven: 10 });
    await h.adapter.createOrder({ ...sale, total: 7.35, drawerSessionId: mine.id });
    await h.adapter.createOrder({ ...sale, paymentMethod: 'Card', drawerSessionId: mine.id });
    await h.adapter.createOrder({ ...sale, drawerSessionId: theirs.id });

    expect(await h.adapter.getExpectedDrawerCash(String(mine.id))).toBeCloseTo(117.35, 2);
    expect(await h.adapter.getExpectedDrawerCash(String(theirs.id))).toBe(10);
    expect(await h.adapter.getExpectedDrawerCash('missing')).toBe(0);
  });

  it('closes once with the variance in cents, freeing the register for the next session', async () => {
    const closer = await seedUser(h.adapter, 'close@example.com', 'Closer');
    const session = await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 100 });

    const closed = await h.adapter.closeDrawerSession(String(session.id), 99.75, 100, closer, 'short a quarter');

    expect(closed).toMatchObject({ status: 'closed', countedCash: 99.75, expectedCash: 100, variance: -0.25, notes: 'short a quarter', closedBy: closer });
    expect(await h.adapter.closeDrawerSession(String(session.id), 200, 100)).toBeNull();
    expect(await h.adapter.getOpenDrawerSession(MAIN_REGISTER)).toBeNull();
    expect(await h.adapter.openDrawerSession({ registerId: MAIN_REGISTER, openingFloat: 0 })).toMatchObject({ status: 'open' });

    const history = await h.adapter.getDrawerSessions(10, MAIN_REGISTER);
    expect(history).toHaveLength(2);
    expect(history.find((s) => s.id === session.id)).toMatchObject({ closedByName: 'Closer' });
    expect(await h.adapter.getDrawerSessions(1)).toHaveLength(1);
  });

  it('wraps a session for an unknown register as a DatabaseError', async () => {
    await expect(h.adapter.openDrawerSession({ registerId: 'missing', openingFloat: 0 })).rejects.toThrow('Failed to open drawer session');
  });
});
