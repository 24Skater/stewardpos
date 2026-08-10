import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Configuration, as the process actually builds it at boot.
 *
 * This module validates on import and calls `process.exit(1)` on failure, which
 * is the right behaviour — a server that boots with a weak JWT secret is worse
 * than one that refuses to boot — but it means the only way to test it is to
 * re-import it under different environments with `process.exit` intercepted.
 *
 * The property that matters most: a deployment cannot start with a signing
 * secret short enough to brute force, and cannot start with nothing set at all.
 */
const GOOD_SECRET = 'a'.repeat(32);

/** Load a fresh copy of the config module under the given environment. */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  const module = await import('../index');
  return module.default;
}

let exitCalls: number[];

beforeEach(() => {
  exitCalls = [];
  // Throwing rather than exiting: a real `process.exit` would take the test
  // runner down with it, and swallowing it would let a failed load look valid.
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    throw new Error(`process.exit(${code})`);
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('a valid environment', () => {
  it('builds', async () => {
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET, DB_ADAPTER: 'postgres' });

    expect(config.jwt.secret).toBe(GOOD_SECRET);
  });

  it('reads the database settings through', async () => {
    const config = await loadConfig({
      JWT_SECRET: GOOD_SECRET,
      DB_ADAPTER: 'postgres',
      DB_HOST: 'db.internal',
      DB_PORT: '6000',
      DB_NAME: 'shop',
    });

    expect(config.database).toMatchObject({ host: 'db.internal', port: 6000, name: 'shop' });
  });

  it('coerces numeric environment values, which arrive as strings', async () => {
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET, PORT: '4000' });

    expect(config.port).toBe(4000);
  });
});

describe('the JWT secret', () => {
  it('refuses to start with a secret shorter than 32 characters', async () => {
    // A server that boots with a guessable signing secret is worse than one
    // that refuses to boot: every token it ever issues is forgeable.
    await expect(loadConfig({ JWT_SECRET: 'short' })).rejects.toThrow(/process.exit/);
    expect(exitCalls).toEqual([1]);
  });

  it('refuses to start with no secret at all', async () => {
    await expect(loadConfig({ JWT_SECRET: '' })).rejects.toThrow(/process.exit/);
  });

  it('accepts exactly 32 characters', async () => {
    const config = await loadConfig({ JWT_SECRET: 'b'.repeat(32) });

    expect(config.jwt.secret).toHaveLength(32);
  });
});

describe('rate limiting defaults', () => {
  it('allows enough requests for a real trading day', async () => {
    // Measured against the app: opening the register costs ~24 calls and each
    // sale adds ~3. The old default of 100 meant roughly 25 sales per
    // quarter-hour for an entire store, since every till shares one public IP.
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET });

    expect(config.rateLimit.maxRequests).toBeGreaterThanOrEqual(3000);
  });

  it('keeps the sign-in limit tight', async () => {
    // Failed sign-ins are the thing worth throttling hard; ordinary traffic is
    // not.
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET });

    expect(config.rateLimit.maxLoginAttempts).toBeLessThanOrEqual(20);
  });

  it('is overridable', async () => {
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET, RATE_LIMIT_MAX_REQUESTS: '500' });

    expect(config.rateLimit.maxRequests).toBe(500);
  });
});

describe('trustProxy', () => {
  it('defaults to trusting nothing', async () => {
    // Trusting `X-Forwarded-For` when nothing sets it lets any client spoof its
    // address and bypass every limit. The opposite mistake — not trusting a
    // real proxy — merely makes the whole internet share one bucket, which is
    // recoverable.
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET });

    expect(config.trustProxy).toBe(0);
  });

  it('takes the number of proxies actually in front', async () => {
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET, TRUST_PROXY: '1' });

    expect(config.trustProxy).toBe(1);
  });

  it('refuses a negative value', async () => {
    await expect(loadConfig({ JWT_SECRET: GOOD_SECRET, TRUST_PROXY: '-1' })).rejects.toThrow();
  });
});

describe('adapters', () => {
  it('defaults email to the console adapter', async () => {
    // Which is why the receipt endpoint reports `logged` rather than `sent`
    // until a real adapter is configured.
    const config = await loadConfig({ JWT_SECRET: GOOD_SECRET });

    expect(config.email.adapter).toBe('console');
  });

  it('refuses an email adapter it does not implement', async () => {
    await expect(
      loadConfig({ JWT_SECRET: GOOD_SECRET, EMAIL_ADAPTER: 'carrier-pigeon' })
    ).rejects.toThrow();
  });

  it('refuses a database adapter it does not implement', async () => {
    await expect(loadConfig({ JWT_SECRET: GOOD_SECRET, DB_ADAPTER: 'mysql' })).rejects.toThrow();
  });
});
