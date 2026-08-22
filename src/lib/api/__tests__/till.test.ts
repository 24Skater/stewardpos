import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../auth';
import { adminApi } from '../admin';

/**
 * These assert the URL and body the SDK sends. A method that posts to the wrong
 * path typechecks perfectly and fails only in a browser, which is exactly the
 * class of defect this suite exists to catch.
 */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { token: 't', expiresIn: '30m', register: { id: 'reg1' }, user: null, shift: null },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

/** The path and RequestInit of the most recent call, with the env base URL stripped. */
function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');

  const base = import.meta.env.VITE_API_BASE_URL || '';
  const url = String(call[0]);

  return [base && url.startsWith(base) ? url.slice(base.length) : url, (call[1] ?? {}) as RequestInit];
}

describe('authApi.till', () => {
  it('posts the PIN to the till endpoint', async () => {
    await authApi.till({ pin: '4821' });

    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/till');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ pin: '4821' });
  });

  it('sends an empty body on a register that needs no PIN', async () => {
    // The endpoint 400s on a PIN it did not ask for, so an undefined must not
    // be serialised as a key at all.
    await authApi.till({});

    const [, init] = lastCall();
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('never names a register: the device token selects it', async () => {
    await authApi.till({ pin: '4821' });

    const [, init] = lastCall();
    expect(JSON.parse(String(init.body))).not.toHaveProperty('registerId');
  });
});

describe('authApi.assumeTill', () => {
  it('posts the register and the emulated cashier', async () => {
    await authApi.assumeTill({ registerId: 'reg1', emulateUserId: 'u1' });

    const [url, init] = lastCall();
    expect(url).toBe('/api/auth/till/assume');
    expect(JSON.parse(String(init.body))).toEqual({ registerId: 'reg1', emulateUserId: 'u1' });
  });
});

describe('adminApi.users.unlockPin', () => {
  it('posts to the unlock route without changing the PIN', async () => {
    await adminApi.users.unlockPin('u1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/admin/users/u1/pin/unlock');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
  });
});
