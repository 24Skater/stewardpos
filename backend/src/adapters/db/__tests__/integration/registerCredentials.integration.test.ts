import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Migration 017's TWO partial unique indexes, against a real Postgres.
 *
 * `X-Register-Id` (migration 016) is a claim, not proof — any authenticated
 * browser can send it, so revoking a register meant nothing before this
 * table existed. What makes revocation mean something is
 * `idx_register_credentials_one_enrolled_per_register`: at most one
 * enrolled (redeemed) credential per register. That index is deliberately
 * separate from `idx_register_credentials_one_pairing_per_register` — at
 * most one outstanding, not-yet-redeemed pairing code — rather than one
 * index covering both. A single combined index would forbid an outstanding
 * pairing code from ever coexisting with a live token, which is exactly
 * the case that has to be allowed: generating a fresh code for a register
 * that is currently trading must not collide with, and therefore must not
 * force revoking, the token it's trading on. That is exactly the kind of
 * thing a mocked adapter cannot prove — it has to be checked against the
 * real indexes.
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

async function insertPairingRow(regId: string, prefix: string, hash: string) {
  return h.query(
    `INSERT INTO register_credentials (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at)
     VALUES ($1, $2, $3, NOW() + interval '15 minutes')
     RETURNING id`,
    [regId, prefix, hash]
  );
}

async function insertEnrolledRow(regId: string, prefix: string, hash: string, tokenPrefix: string, tokenHash: string) {
  return h.query(
    `INSERT INTO register_credentials
      (register_id, pairing_code_prefix, pairing_code_hash, pairing_expires_at, token_prefix, token_hash, enrolled_at)
     VALUES ($1, $2, $3, NOW() + interval '15 minutes', $4, $5, NOW())
     RETURNING id`,
    [regId, prefix, hash, tokenPrefix, tokenHash]
  );
}

describe('idx_register_credentials_one_pairing_per_register (raw SQL)', () => {
  it('rejects a second outstanding pairing row for the same register, but permits one for a sibling', async () => {
    await insertPairingRow(registerId, 'AAAA', 'hash-1');

    await expect(insertPairingRow(registerId, 'BBBB', 'hash-2')).rejects.toThrow();

    // A different register is a different identity for the index — this
    // must succeed even while the first register still holds a live row.
    await expect(insertPairingRow(siblingRegisterId, 'CCCC', 'hash-3')).resolves.toBeDefined();

    await h.query('DELETE FROM register_credentials WHERE register_id IN ($1, $2)', [
      registerId,
      siblingRegisterId,
    ]);
  });

  it('permits a new outstanding row once the prior one is revoked', async () => {
    const first = await insertPairingRow(registerId, 'DDDD', 'hash-4');
    await h.query('UPDATE register_credentials SET revoked_at = NOW() WHERE id = $1', [first.rows[0].id]);

    // The old row is revoked, so this must no longer collide with it.
    await expect(insertPairingRow(registerId, 'EEEE', 'hash-5')).resolves.toBeDefined();

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

describe('idx_register_credentials_one_enrolled_per_register (raw SQL)', () => {
  it('rejects a second enrolled credential for the same register, but permits one for a sibling', async () => {
    await insertEnrolledRow(registerId, 'GGGG', 'hash-7', 'srt_aaaaaaaa', 'token-hash-1');

    await expect(insertEnrolledRow(registerId, 'HHHH', 'hash-8', 'srt_bbbbbbbb', 'token-hash-2')).rejects.toThrow();

    await expect(
      insertEnrolledRow(siblingRegisterId, 'IIII', 'hash-9', 'srt_cccccccc', 'token-hash-3')
    ).resolves.toBeDefined();

    await h.query('DELETE FROM register_credentials WHERE register_id IN ($1, $2)', [
      registerId,
      siblingRegisterId,
    ]);
  });
});

describe('an outstanding pairing row and an enrolled credential coexisting (raw SQL)', () => {
  it(
    'permits both at once for the same register — the exact case a single combined ' +
      'index would have forbidden, forcing pairing-code generation to be destructive',
    async () => {
      await expect(insertEnrolledRow(registerId, 'JJJJ', 'hash-10', 'srt_dddddddd', 'token-hash-4')).resolves.toBeDefined();
      await expect(insertPairingRow(registerId, 'KKKK', 'hash-11')).resolves.toBeDefined();

      const { rows } = await h.query(
        'SELECT token_hash FROM register_credentials WHERE register_id = $1 AND revoked_at IS NULL ORDER BY token_hash NULLS LAST',
        [registerId]
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].token_hash).not.toBeNull();
      expect(rows[1].token_hash).toBeNull();

      await h.query('DELETE FROM register_credentials WHERE register_id = $1', [registerId]);
    }
  );
});

describe('the same invariants through the adapter surface', () => {
  it('getLiveUnredeemedPairingCredential / getLiveEnrolledCredential / getLiveRegisterCredentials round-trip correctly', async () => {
    const pairing = await h.adapter.createPairingCredential({
      registerId,
      pairingCodePrefix: 'LLLL',
      pairingCodeHash: 'hash-12',
      pairingExpiresAt: Date.now() + 15 * 60 * 1000,
      createdBy: null,
    });
    expect(pairing.registerId).toBe(registerId);
    expect(pairing.revokedAt).toBeNull();

    expect((await h.adapter.getLiveUnredeemedPairingCredential(registerId))?.id).toBe(pairing.id);
    expect(await h.adapter.getLiveEnrolledCredential(registerId)).toBeNull();

    // A second createPairingCredential call for the same register, without
    // revoking first, must collide on the pairing index.
    await expect(
      h.adapter.createPairingCredential({
        registerId,
        pairingCodePrefix: 'MMMM',
        pairingCodeHash: 'hash-13',
        pairingExpiresAt: Date.now() + 15 * 60 * 1000,
        createdBy: null,
      })
    ).rejects.toThrow();

    // Redeeming it (via the adapter's own redeemPairingCredential, not raw
    // SQL) turns it into an enrolled credential — and it must now be
    // possible to ALSO issue a new outstanding pairing row alongside it,
    // which the old single-index design would have forbidden.
    const redeemed = await h.adapter.redeemPairingCredential(String(pairing.id), {
      tokenPrefix: 'srt_eeeeeeee',
      tokenHash: 'token-hash-5',
      enrolledAt: Date.now(),
    });
    expect(redeemed?.tokenHash).toBe('token-hash-5');

    expect(await h.adapter.getLiveUnredeemedPairingCredential(registerId)).toBeNull();
    expect((await h.adapter.getLiveEnrolledCredential(registerId))?.id).toBe(pairing.id);

    const freshPairing = await h.adapter.createPairingCredential({
      registerId,
      pairingCodePrefix: 'NNNN',
      pairingCodeHash: 'hash-14',
      pairingExpiresAt: Date.now() + 15 * 60 * 1000,
      createdBy: null,
    });
    expect(freshPairing.revokedAt).toBeNull();

    // Both live at once: getLiveRegisterCredentials — the "revoke
    // everything" surface — must see both rows.
    const allLive = await h.adapter.getLiveRegisterCredentials(registerId);
    expect(allLive.map((row) => row.id).sort()).toEqual([pairing.id, freshPairing.id].sort());

    // Revoking one leaves the other alone.
    const revoked = await h.adapter.revokeRegisterCredentialById(String(pairing.id), {
      revokedBy: null,
      reason: 'integration test cleanup',
    });
    expect(revoked?.revokedAt).not.toBeNull();

    // Revoking twice is a no-op (guarded on `revoked_at IS NULL`), not an
    // error and not a second audit-worthy event.
    expect(
      await h.adapter.revokeRegisterCredentialById(String(pairing.id), { revokedBy: null, reason: 'second attempt' })
    ).toBeNull();

    const remaining = await h.adapter.getLiveRegisterCredentials(registerId);
    expect(remaining.map((row) => row.id)).toEqual([freshPairing.id]);

    await h.query('DELETE FROM register_credentials WHERE register_id = $1', [registerId]);
  });
});
