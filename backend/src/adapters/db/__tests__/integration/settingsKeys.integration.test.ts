import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, tag, type Harness } from './harness';

/**
 * Settings and API key SQL against a real Postgres.
 *
 * Settings is a single row upserted with COALESCE throughout, which is the
 * mechanism the payment-credential preservation depends on: saving the store's
 * phone number must not blank the terminal keys and take card payments offline.
 * The route-level test for that mocks the adapter, so the COALESCE — the part
 * that actually does the preserving — was never executed by a test.
 *
 * API keys matter for a narrower reason: `getApiKeyByPrefix` is what every
 * `X-API-Key` request resolves against, and it must not return a revoked or
 * expired key.
 */
let h: Harness;
const mark = tag();

const keyIds: string[] = [];

/** The settings row as it was, so this file leaves the database as it found it. */
let originalSettings: Record<string, unknown> | null = null;

async function makeKey(overrides: Record<string, unknown> = {}) {
  const created = await h.adapter.createApiKey({
    name: `${mark} key ${keyIds.length}`,
    keyPrefix: `sp_${mark}${keyIds.length}`,
    keyHash: '$2a$10$abcdefghijklmnopqrstuv',
    scopes: ['read'],
    rateLimit: 1000,
    ...overrides,
  });
  keyIds.push(String(created.id));
  return created;
}

beforeAll(async () => {
  h = await connect();
  const { rows } = await h.query('SELECT * FROM settings WHERE id = 1');
  originalSettings = rows[0] ?? null;
}, 30_000);

afterAll(async () => {
  if (keyIds.length > 0) {
    await h.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
  }
  // Put the singleton back exactly as it was, rather than leaving this file's
  // values behind for whatever runs next.
  if (originalSettings) {
    await h.query(
      `UPDATE settings SET store_name = $1, store_phone = $2, tax_rate_default = $3, config = $4
       WHERE id = 1`,
      [
        originalSettings.store_name,
        originalSettings.store_phone,
        originalSettings.tax_rate_default,
        originalSettings.config,
      ]
    );
  }
  await h.close();
});

describe('settings', () => {
  it('writes and reads a value back', async () => {
    await h.adapter.updateSettings({ storeName: `${mark} Corner Shop` });

    expect(await h.adapter.getSettings()).toMatchObject({ storeName: `${mark} Corner Shop` });
  });

  it('leaves other fields alone on a partial update', async () => {
    // This is the whole reason for the COALESCE. Without it, saving the phone
    // number would blank the store name — and, in the case that matters, the
    // stored terminal credentials, taking card payments offline.
    await h.adapter.updateSettings({ storeName: `${mark} Keep Me`, storePhone: '555-0100' });
    await h.adapter.updateSettings({ storePhone: '555-0199' });

    expect(await h.adapter.getSettings()).toMatchObject({
      storeName: `${mark} Keep Me`,
      storePhone: '555-0199',
    });
  });

  it('preserves stored config through an unrelated save', async () => {
    // `config` holds the terminal credentials. A save of anything else must not
    // touch it.
    await h.adapter.updateSettings({ config: { lowStockThreshold: 7, marker: mark } });
    await h.adapter.updateSettings({ storeName: `${mark} Something Else` });

    const settings = await h.adapter.getSettings();
    expect(settings.config).toMatchObject({ lowStockThreshold: 7, marker: mark });
  });

  it('stays a single row however many times it is written', async () => {
    await h.adapter.updateSettings({ storeName: `${mark} One` });
    await h.adapter.updateSettings({ storeName: `${mark} Two` });

    const { rows } = await h.query('SELECT COUNT(*)::int AS count FROM settings');
    expect(rows[0].count).toBe(1);
  });

  it('round-trips a tax rate exactly', async () => {
    // Tax feeds every total; a rate stored as an approximation is money.
    await h.adapter.updateSettings({ taxRateDefault: 0.0825 });

    expect((await h.adapter.getSettings()).taxRateDefault).toBe(0.0825);
  });
});

describe('api keys', () => {
  it('creates one and reads it back by id', async () => {
    const created = await makeKey();

    expect(await h.adapter.getApiKeyById(String(created.id))).toMatchObject({
      name: `${mark} key 0`,
    });
  });

  it('resolves by prefix, which is how a request authenticates', async () => {
    const created = await makeKey();

    const found = await h.adapter.getApiKeyByPrefix(String(created.keyPrefix));
    expect(found).toBeTruthy();
    expect(String(found.id)).toBe(String(created.id));
  });

  it('carries the hash on the prefix lookup, since that is what gets compared', async () => {
    const created = await makeKey();

    const found = await h.adapter.getApiKeyByPrefix(String(created.keyPrefix));
    expect(found.keyHash).toBeTruthy();
  });

  it('round-trips scopes as an array, not a JSON string', async () => {
    // They are stored as JSON. Coming back as a string would make every scope
    // check compare against characters and quietly deny everything.
    const created = await makeKey({ scopes: ['read', 'write'] });

    const found = await h.adapter.getApiKeyById(String(created.id));
    expect(Array.isArray(found.scopes)).toBe(true);
    expect(found.scopes).toEqual(['read', 'write']);
  });

  it('defaults to read-only when no scope is given', async () => {
    const created = await makeKey({ scopes: undefined });

    expect((await h.adapter.getApiKeyById(String(created.id))).scopes).toEqual(['read']);
  });

  it('does not resolve a revoked key', async () => {
    // Revocation is enforced in the query (`is_active = true`), so a key
    // deactivated after issue stops authenticating immediately rather than at
    // whatever point something else happens to check.
    const created = await makeKey();
    await h.query('UPDATE api_keys SET is_active = false WHERE id = $1', [created.id]);

    expect(await h.adapter.getApiKeyByPrefix(String(created.keyPrefix))).toBeNull();
  });

  it('still resolves an expired key, because expiry is the middleware’s job', async () => {
    // Documenting the division deliberately: the query filters on revocation,
    // `authenticate` refuses on `expiresAt`. Anyone tightening one of these
    // should know the other exists, or they will remove the only check.
    const created = await makeKey({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() });

    const found = await h.adapter.getApiKeyByPrefix(String(created.keyPrefix));
    expect(found).toBeTruthy();
    expect(Number(found.expiresAt)).toBeLessThan(Date.now());
  });

  it('returns nothing for an unknown prefix', async () => {
    expect(await h.adapter.getApiKeyByPrefix(`sp_${mark}nosuch`)).toBeNull();
  });

  it('records last use without disturbing anything else', async () => {
    const created = await makeKey();

    await h.adapter.updateApiKeyLastUsed(String(created.id));

    const found = await h.adapter.getApiKeyById(String(created.id));
    expect(found.lastUsedAt).toBeTruthy();
    expect(found.name).toBe(String(created.name));
  });

  it('deletes one', async () => {
    const created = await makeKey();

    expect(await h.adapter.deleteApiKey(String(created.id))).toBe(true);
    expect(await h.adapter.getApiKeyById(String(created.id))).toBeNull();
  });
});
