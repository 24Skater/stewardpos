import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * The register, location, credential and shift reads that every till request
 * runs through `authenticate` and `registerAuth`, and that no integration test
 * had executed: `getRegisterById`, `getLocations`, `getOrgPolicy`, the
 * credential prefix lookups, the heartbeat writes, and `getRegisterShiftById`.
 */
let h: Harness;
const mark = tag();

let orgId: string;
let otherOrgId: string;
let activeLocId: string;
let inactiveLocId: string;
let registerId: string;
let retiredRegisterId: string;
let userId: string;

const NIL = '00000000-0000-0000-0000-00000000dead';

async function makeOrg(label: string, maxRegisters: number | null): Promise<string> {
  const { rows } = await h.query(
    'INSERT INTO organizations (name, slug, max_registers, pin_length) VALUES ($1, $2, $3, 4) RETURNING id',
    [`${mark} ${label}`, `${mark}-${label}`, maxRegisters]
  );
  return String(rows[0].id);
}

async function makeRegister(locationId: string, n: number): Promise<string> {
  const reg = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} reg ${n}`,
    register_number: n,
    display_code: `${mark}-R${n}`,
  });
  if (typeof reg === 'string') throw new Error(`expected a register row, got ${reg}`);
  return String(reg.id);
}

beforeAll(async () => {
  h = await connect();
  orgId = await makeOrg('org', 3);
  otherOrgId = await makeOrg('other', null);

  const loc = async (org: string, name: string, status: string) =>
    String(
      (
        await h.query(
          'INSERT INTO locations (org_id, name, slug, status) VALUES ($1, $2, $3, $4) RETURNING id',
          [org, `${mark} ${name}`, `${mark}-${name}`, status]
        )
      ).rows[0].id
    );
  // Named so alphabetical order would put the inactive one first.
  inactiveLocId = await loc(orgId, 'a-closed', 'inactive');
  activeLocId = await loc(orgId, 'z-open', 'active');
  await loc(otherOrgId, 'elsewhere', 'active');

  registerId = await makeRegister(activeLocId, 1);
  await makeRegister(activeLocId, 2);
  retiredRegisterId = await makeRegister(activeLocId, 3);
  await h.query("UPDATE registers SET status = 'retired' WHERE id = $1", [retiredRegisterId]);

  const user = await h.adapter.createUser({
    email: `${mark}-cashier@example.com`,
    passwordHash: 'not-a-real-hash',
    name: `${mark} Cashier`,
    status: 'active',
    roleIds: [],
  });
  userId = String(user.id);
}, 30_000);

afterAll(async () => {
  await h.query(
    'DELETE FROM register_shifts WHERE register_id IN (SELECT id FROM registers WHERE org_id = $1)',
    [orgId]
  );
  await h.query(
    'DELETE FROM register_credentials WHERE register_id IN (SELECT id FROM registers WHERE org_id = $1)',
    [orgId]
  );
  await h.query('DELETE FROM registers WHERE org_id = $1', [orgId]);
  await h.query('DELETE FROM locations WHERE org_id IN ($1, $2)', [orgId, otherOrgId]);
  await h.query('DELETE FROM users WHERE id = $1', [userId]);
  await h.query('DELETE FROM organizations WHERE id IN ($1, $2)', [orgId, otherOrgId]);
  await h.close();
});

describe('locations', () => {
  it('lists only this org’s locations, active first, each with its non-retired register count', async () => {
    const locations = await h.adapter.getLocations(orgId);

    expect(locations.map((l) => l.id)).toEqual([activeLocId, inactiveLocId]);
    expect(locations[0]).toMatchObject({ orgId, status: 'active', registerCount: 2 });
    expect(locations[1]).toMatchObject({ registerCount: 0 });
  });

  it('reads one location by id, and null for an unknown id', async () => {
    expect(await h.adapter.getLocationById(activeLocId)).toMatchObject({
      id: activeLocId,
      slug: `${mark}-z-open`,
      timezone: 'UTC',
    });
    expect(await h.adapter.getLocationById(NIL)).toBeNull();
  });
});

describe('registers', () => {
  it('reads a register with its location’s name joined in', async () => {
    const reg = await h.adapter.getRegisterById(registerId);

    expect(reg).toMatchObject({
      id: registerId,
      orgId,
      locationId: activeLocId,
      locationName: `${mark} z-open`,
      registerNumber: 1,
      hasCashDrawer: true,
      lastSeenAt: null,
    });
  });

  it('returns null for an unknown register', async () => {
    expect(await h.adapter.getRegisterById(NIL)).toBeNull();
  });

  it('sets a register’s status and returns the updated row', async () => {
    const reg = await h.adapter.setRegisterStatus(registerId, 'disabled');

    expect(reg).toMatchObject({ id: registerId, status: 'disabled' });
    expect((await h.adapter.getRegisterById(registerId))!.status).toBe('disabled');

    await h.adapter.setRegisterStatus(registerId, 'active');
  });

  it('returns null when setting the status of a register that does not exist', async () => {
    expect(await h.adapter.setRegisterStatus(NIL, 'active')).toBeNull();
  });

  it('stamps a heartbeat on the register', async () => {
    const reg = await h.adapter.touchRegisterLastSeen(registerId);

    expect(reg!.lastSeenAt).toEqual(expect.any(Number));
    expect(await h.adapter.touchRegisterLastSeen(NIL)).toBeNull();
  });
});

describe('org policy', () => {
  it('reads the register cap and PIN length', async () => {
    expect(await h.adapter.getOrgPolicy(orgId)).toEqual({ maxRegisters: 3, pinLength: 4 });
  });

  it('reports an unlimited cap as null rather than 0', async () => {
    expect(await h.adapter.getOrgPolicy(otherOrgId)).toEqual({ maxRegisters: null, pinLength: 4 });
  });

  it('returns null for an org that does not exist', async () => {
    expect(await h.adapter.getOrgPolicy(NIL)).toBeNull();
  });
});

describe('register credentials', () => {
  it('finds pairing and token rows by prefix, and only those', async () => {
    const pairingPrefix = mark.slice(-4).toUpperCase();
    const cred = await h.adapter.createPairingCredential({
      registerId,
      pairingCodePrefix: pairingPrefix,
      pairingCodeHash: 'hash',
      pairingExpiresAt: Date.now() + 60_000,
      createdBy: null,
    });
    const tokenPrefix = `srt_${mark}`;
    await h.adapter.redeemPairingCredential(String(cred.id), {
      tokenPrefix,
      tokenHash: 'token-hash',
      enrolledAt: Date.now(),
    });

    const byPairing = await h.adapter.getPairingCredentialsByPrefix(pairingPrefix);
    const byToken = await h.adapter.getRegisterCredentialsByTokenPrefix(tokenPrefix);

    expect(byPairing.map((c) => c.id)).toEqual([cred.id]);
    expect(byToken).toHaveLength(1);
    expect(byToken[0]).toMatchObject({ registerId, tokenHash: 'token-hash', lastUsedAt: null });
    expect(await h.adapter.getRegisterCredentialsByTokenPrefix(`srt_none_${mark}`)).toEqual([]);
  });

  it('stamps last-used on a credential, and swallows a failure rather than failing the request', async () => {
    const [cred] = await h.adapter.getRegisterCredentialsByTokenPrefix(`srt_${mark}`);

    await h.adapter.touchRegisterCredentialLastUsed(String(cred.id));
    // Not a UUID: Postgres rejects the cast, and the method must not throw.
    await expect(h.adapter.touchRegisterCredentialLastUsed('not-a-uuid')).resolves.toBeUndefined();

    const [after] = await h.adapter.getRegisterCredentialsByTokenPrefix(`srt_${mark}`);
    expect(after.lastUsedAt).toEqual(expect.any(Number));
  });
});

describe('register shifts', () => {
  it('reads a shift by id whether open or ended, so “ended” is distinguishable from “never existed”', async () => {
    const shift = await h.adapter.createRegisterShift({ registerId, userId });

    expect(await h.adapter.getRegisterShiftById(String(shift.id))).toMatchObject({
      id: shift.id,
      registerId,
      userId,
      endedAt: null,
      emulatedUserId: null,
    });

    await h.adapter.endRegisterShift(String(shift.id), 'signed_out');

    expect(await h.adapter.getRegisterShiftById(String(shift.id))).toMatchObject({
      endedAt: expect.any(Number),
      endReason: 'signed_out',
    });
    expect(await h.adapter.getRegisterShiftById(NIL)).toBeNull();
  });
});

describe('database errors', () => {
  it('maps a malformed id to a DatabaseError rather than leaking the driver error', async () => {
    await expect(h.adapter.getRegisterById('not-a-uuid')).rejects.toThrow('Failed to get register');
    await expect(h.adapter.getLocationById('not-a-uuid')).rejects.toThrow('Failed to get location');
    await expect(h.adapter.getOrgPolicy('not-a-uuid')).rejects.toThrow('Failed to get organization policy');
    await expect(h.adapter.getRegisterShiftById('not-a-uuid')).rejects.toThrow('Failed to get register shift');
  });
});
