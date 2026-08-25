import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Invalidating the session has to reach both caches.
 *
 * There are two: TanStack's, keyed `['session']`, and a module-level variable
 * inside `auth.ts` that `getCurrentSession` returns from an early-return branch
 * without asking the server. `useInvalidateSession` only cleared the first, so
 * the query re-ran, hit the second, and handed back the same object — an
 * invalidation that looked like it worked and changed nothing.
 *
 * These exercise the real `auth.ts`, stubbing only the HTTP call, because the
 * bug lived in the interaction between the two caches. Mocking
 * `getCurrentSession` would have removed the thing under test.
 */

const get = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

const getToken = vi.fn(() => 'a-token');
const isTokenExpired = vi.fn(() => false);

vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authStore: { ...(actual.authStore as object), getToken, isTokenExpired, clearToken: vi.fn() },
  };
});

const { useSession, useInvalidateSession } = await import('../useSession');
const { clearSessionCache } = await import('@/lib/auth');

function user(permissions: Record<string, unknown>) {
  return {
    user: {
      id: 'u1',
      email: 'someone@example.com',
      name: 'Someone',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Role', systemRole: 'standard', permissions }],
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionCache();
  getToken.mockReturnValue('a-token');
  isTokenExpired.mockReturnValue(false);
});

describe('useInvalidateSession', () => {
  it('re-reads permissions that changed while the user was signed in', async () => {
    get.mockResolvedValueOnce(user({ registers: { read: false } }));

    const { result } = renderHook(
      () => ({ session: useSession(), invalidate: useInvalidateSession() }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.session.data).toBeTruthy());
    expect(result.current.session.data?.permissions.registers.read).toBe(false);

    // An administrator grants the permission; the app asks again.
    get.mockResolvedValueOnce(user({ registers: { read: true } }));
    await act(async () => {
      await result.current.invalidate();
    });

    await waitFor(() =>
      expect(result.current.session.data?.permissions.registers.read).toBe(true)
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('actually asks the server again rather than replaying the module cache', async () => {
    get.mockResolvedValue(user({}));

    const { result } = renderHook(
      () => ({ session: useSession(), invalidate: useInvalidateSession() }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.session.data).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.invalidate();
    });

    // Before the fix this stayed at 1: the query re-ran, but `getCurrentSession`
    // returned its cached object without a request.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe('useSession', () => {
  it('resolves null when signed out rather than erroring', async () => {
    getToken.mockReturnValue(null as unknown as string);

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('does not re-request on a second mount within the stale window', async () => {
    get.mockResolvedValue(user({}));

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    renderHook(() => useSession(), { wrapper });

    expect(get).toHaveBeenCalledTimes(1);
  });
});
