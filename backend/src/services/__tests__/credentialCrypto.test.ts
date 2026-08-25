import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Keeping someone else's payment key out of a database dump.
 *
 * The property that matters is not that the bytes look scrambled — it is that
 * an install can adopt this, or fail to, without losing the ability to take
 * card payments. Getting encryption wrong here does not produce a subtle bug;
 * it produces a shop that cannot charge anyone.
 */

const KEY = 'a-high-entropy-value-from-openssl-rand';

async function loadModule() {
  // Re-imported per test because the derived key is cached against the
  // environment variable, which these tests change.
  vi.resetModules();
  return import('../credentialCrypto');
}

const originalKey = process.env.CREDENTIALS_KEY;

beforeEach(() => {
  process.env.CREDENTIALS_KEY = KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIALS_KEY;
  else process.env.CREDENTIALS_KEY = originalKey;
});

describe('with a key configured', () => {
  it('round-trips a secret', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();

    const stored = encryptSecret('rk_live_abc123');

    expect(stored).not.toContain('rk_live_abc123');
    expect(decryptSecret(stored)).toBe('rk_live_abc123');
  });

  it('produces different ciphertext each time', async () => {
    // A fresh IV per value. Identical output for identical input would leak
    // which shops share a key, and that two saves did not change anything.
    const { encryptSecret } = await loadModule();

    expect(encryptSecret('rk_live_abc')).not.toBe(encryptSecret('rk_live_abc'));
  });

  it('refuses a value that has been tampered with', async () => {
    // GCM authenticates as well as encrypts, so an edited ciphertext fails
    // rather than decrypting to different bytes.
    const { encryptSecret, decryptSecret } = await loadModule();
    const stored = encryptSecret('rk_live_abc123');
    const tampered = `${stored.slice(0, -4)}AAAA`;

    expect(() => decryptSecret(tampered)).toThrow(/could not be decrypted/i);
  });

  it('does not encrypt an already-encrypted value twice', async () => {
    const { encryptSecret, decryptSecret } = await loadModule();
    const once = encryptSecret('rk_live_abc');

    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(encryptSecret(once))).toBe('rk_live_abc');
  });

  it('reads back a credential saved before encryption existed', async () => {
    // The upgrade path. A stored plaintext key has no marker, and must keep
    // working or turning encryption on takes card payments offline.
    const { decryptSecret } = await loadModule();

    expect(decryptSecret('sk_live_legacy')).toBe('sk_live_legacy');
  });

  it('encrypts every secret in a bag and leaves the rest alone', async () => {
    const { encryptCredentials, decryptCredentials } = await loadModule();

    const stored = encryptCredentials({
      stripeSecretKey: 'rk_live_abc',
      stripeReaderId: 'tmr_1',
      sandbox: true,
    });

    expect(stored.stripeSecretKey).not.toBe('rk_live_abc');
    expect(stored.sandbox).toBe(true);
    expect(decryptCredentials(stored)).toEqual({
      stripeSecretKey: 'rk_live_abc',
      stripeReaderId: 'tmr_1',
      sandbox: true,
    });
  });
});

describe('with no key configured', () => {
  beforeEach(() => {
    delete process.env.CREDENTIALS_KEY;
  });

  it('stores the value unchanged rather than refusing to save', async () => {
    // An install that has not set a key must keep working exactly as before.
    // Failing here would turn a security improvement into an outage on upgrade.
    const { encryptSecret } = await loadModule();

    expect(encryptSecret('sk_test_abc')).toBe('sk_test_abc');
  });

  it('says plainly when it meets ciphertext it cannot open', async () => {
    // The key was set once and is now gone. The symptom otherwise is card
    // payments failing with nothing explaining why.
    process.env.CREDENTIALS_KEY = KEY;
    const withKey = await loadModule();
    const stored = withKey.encryptSecret('rk_live_abc');

    delete process.env.CREDENTIALS_KEY;
    const withoutKey = await loadModule();

    expect(() => withoutKey.decryptSecret(stored)).toThrow(/CREDENTIALS_KEY is not set/i);
  });
});

describe('a changed key', () => {
  it('fails loudly rather than returning wrong bytes', async () => {
    const withOldKey = await loadModule();
    const stored = withOldKey.encryptSecret('rk_live_abc');

    process.env.CREDENTIALS_KEY = 'a-different-key-entirely';
    const withNewKey = await loadModule();

    expect(() => withNewKey.decryptSecret(stored)).toThrow(/may have changed/i);
  });
});
