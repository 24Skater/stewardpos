import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Migration 017's partial unique index, against a real Postgres.
 *
 * `X-Register-Id` (migration 016) is a claim, not proof — any authenticated
 * browser can send it, so revoking a register meant nothing before this
 * table existed. The one constraint that makes revocation mean something is
 * `idx_register_credentials_one_live_per_register`: at most one UNREVOKED
 * credential per register, so issuing a fresh pairing code (or redeeming
 * one) has to actually replace whatever credential came before it, not
 * accumulate beside it. That is exactly the kind of thing a mocked adapter
 * cannot prove — it has to be checked against the real index.
 */
let h: Harness;
const mark = tag();

let orgId: string;
let locationId: string;
let registerId: string;
let siblingRegisterId: string;

beforeAll(async () => {
  h = await connect();

  const org = await h.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [
    `${mark} org`,
    `${mark}-org`,
  ]);
  orgId = String(org.rows[0].id);

  const location = await h.query(
    'INSERT INTO locations (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id',
    [orgId, `${mark} location`, `${mark}-location`]
  );
  locationId = String(location.rows[0].id);

  const register = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} register`,
    register_number: 1,
    display_code: `${mark}-REG-01`,
  });
  if (typeof register === 'string') throw new Error(`expected a register row, got ${register}`);
  registerId = String(register.id);

  const sibling = await h.adapter.createRegister({
    org_id: orgId,
    location_id: locationId,
    name: `${mark} sibling register`,
    register_number: 2,
    display_code: `${mark}-REG-02`,
  });
  if (typeof sibling === 'string') throw new Error(`expected a register row, got ${sibling}`);
  siblingRegisterId = String(sibling.id);
}, 30_000);

afterAll(async () => {
  await h.query('DELETE FROM register_credentials WHERE register_id IN ($1, $2)', [
    registerId,
    siblingRegisterId,
  ]);
  await h.query('DELETE FROM registers WHERE id IN ($1, $2)', [registerId, siblingRegisterId]);
  await h.query('DELETE FROM locations WHERE id = $1', [locationId]);
  await h.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await h.close();
});

describe('idx_register_credentials_one_live_per_register (raw SQL)', () => {
  it('rejects a second live credential for the same register, but permits one for a sibling', async () => {
    await h.query(
      `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
       VALUES ($1, 'AAAA', 'hash-1', NOW() + interval '15 minutes')`,
      [registerId]
    );

    await expect(
      h.query(
        `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
         VALUES ($1, 'BBBB', 'hash-2', NOW() + interval '15 minutes')`,
        [registerId]
      )
    ).rejects.toThrow();

    // A different register is a different identity for the index — this
    // must succeed even while the first register still holds a live row.
    await expect(
      h.query(
        `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
         VALUES ($1, 'CCCC', 'hash-3', NOW() + interval '15 minutes')`,
        [siblingRegisterId]
      )
    ).resolves.toBeDefined();

    await h.query('DELETE FROM register_credentials WHERE register_id IN ($1, $2)', [
      registerId,
      siblingRegisterId,
    ]);
  });

  it('permits a new live credential once the prior one is revoked', async () => {
    const first = await h.query(
      `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
       VALUES ($1, 'DDDD', 'hash-4', NOW() + interval '15 minutes')
       RETURNING id`,
      [registerId]
    );

    await h.query('UPDATE register_credentials SET revoked_at = NOW() WHERE id = $1', [
      first.rows[0].id,
    ]);

    // The old row is revoked, so this must no longer collide with it.
    await expect(
      h.query(
        `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
         VALUES ($1, 'EEEE', 'hash-5', NOW() + interval '15 minutes')`,
        [registerId]
      )
    ).resolves.toBeDefined();

    await h.query('DELETE FROM register_credentials WHERE register_id = $1', [registerId]);
  });

  it('rejects a NULL register_id (NULLs are otherwise distinct in a unique index)', async () => {
    await expect(
      h.query(
        `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
         VALUES (NULL, 'FFFF', 'hash-6', NOW() + interval '15 minutes')`
      )
    ).rejects.toThrow();
  });
});

describe('the same invariant through the adapter surface', () => {
  it('createPairingCredential / getLiveRegisterCredential / revokeRegisterCredentialById round-trip correctly', async () => {
    const issued = await h.adapter.createPairingCredential({
      registerId,
      pairingCodePrefix: 'GGGG',
      pairingCodeHash: 'hash-7',
      pairingExpiresAt: Date.now() + 15 * 60 * 1000,
      createdBy: null,
    });
    expect(issued.registerId).toBe(registerId);
    expect(issued.revokedAt).toBeNull();

    const live = await h.adapter.getLiveRegisterCredential(registerId);
    expect(live?.id).toBe(issued.id);

    // A second createPairingCredential call for the same register, without
    // revoking first, must collide on the exact index this file exists to
    // prove — round-tripped through the adapter, not raw SQL.
    await expect(
      h.adapter.createPairingCredential({
        registerId,
        pairingCodePrefix: 'HHHH',
        pairingCodeHash: 'hash-8',
        pairingExpiresAt: Date.now() + 15 * 60 * 1000,
        createdBy: null,
      })
    ).rejects.toThrow();

    const revoked = await h.adapter.revokeRegisterCredentialById(String(issued.id), {
      revokedBy: null,
      reason: 'integration test cleanup',
    });
    expect(revoked?.revokedAt).not.toBeNull();

    // Revoking twice is a no-op (guarded on `revoked_at IS NULL`), not an
    // error and not a second audit-worthy event.
    const revokedAgain = await h.adapter.revokeRegisterCredentialById(String(issued.id), {
      revokedBy: null,
      reason: 'second attempt',
    });
    expect(revokedAgain).toBeNull();

    expect(await h.adapter.getLiveRegisterCredential(registerId)).toBeNull();

    // Now that the only live credential is revoked, a fresh one must be
    // accepted rather than colliding.
    const reissued = await h.adapter.createPairingCredential({
      registerId,
      pairingCodePrefix: 'IIII',
      pairingCodeHash: 'hash-9',
      pairingExpiresAt: Date.now() + 15 * 60 * 1000,
      createdBy: null,
    });
    expect(reissued.revokedAt).toBeNull();

    await h.query('DELETE FROM register_credentials WHERE register_id = $1', [registerId]);
  });
});
