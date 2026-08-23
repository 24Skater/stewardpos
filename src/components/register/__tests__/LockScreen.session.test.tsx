import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';

/**
 * The PIN pad's job changed: it used to open a shift on an already-authenticated
 * browser, and now it opens the session itself. What this guards is the part a
 * type checker cannot see — that the token the till endpoint returns is actually
 * stored, and stored *before* the caller is told the screen can come down.
 * `RequireTill` reads that token synchronously, so the wrong order leaves the
 * lock screen up over a till that just signed on.
 */

const { till, setToken } = vi.hoisted(() => ({ till: vi.fn(), setToken: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authApi: { ...(actual.authApi as object), till } };
});

vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authStore: { ...(actual.authStore as object), setToken, getToken: () => null },
  };
});

const { default: LockScreen } = await import('../LockScreen');

function renderLock(props: Record<string, unknown> = {}, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  render(
    <QueryClientProvider client={queryClient}>
      <LockScreen {...props} />
    </QueryClientProvider>
  );
  return queryClient;
}

function enterAndSubmit(pin: string) {
  const pad = screen.getByRole('group', { name: 'PIN entry' });
  for (const digit of pin) {
    fireEvent.keyDown(pad, { key: digit });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

beforeEach(() => vi.clearAllMocks());

const session = {
  token: 'jwt-token',
  expiresIn: '24h',
  register: { id: 'reg-1' },
  user: { id: 'u1', name: 'Alex', email: 'alex@example.com' },
  shift: { id: 's1' },
};

describe('LockScreen sign-on', () => {
  it('sends only the PIN: the device token names the register', async () => {
    till.mockResolvedValueOnce(session);
    renderLock();

    enterAndSubmit('4821');

    await waitFor(() => expect(till).toHaveBeenCalledWith({ pin: '4821' }));
  });

  it('stores the token the till endpoint returns', async () => {
    till.mockResolvedValueOnce(session);
    const onUnlocked = vi.fn();
    renderLock({ onUnlocked });

    enterAndSubmit('4821');

    await waitFor(() => expect(setToken).toHaveBeenCalledWith('jwt-token', '24h'));
    expect(onUnlocked).toHaveBeenCalledWith(session);
  });

  it('stores the token before telling the caller to come down', async () => {
    // The other order leaves RequireTill reading a null token and re-rendering
    // this very screen over a till that has just signed on.
    till.mockResolvedValueOnce(session);
    const order: string[] = [];
    setToken.mockImplementation(() => order.push('setToken'));
    renderLock({ onUnlocked: () => order.push('onUnlocked') });

    enterAndSubmit('4821');

    await waitFor(() => expect(order).toEqual(['setToken', 'onUnlocked']));
  });

  it('keeps the pad up and explains a rejected PIN', async () => {
    till.mockRejectedValueOnce(
      new ApiClientError(401, 'That PIN was not recognized', undefined, { code: 'PIN_INVALID' })
    );
    const onUnlocked = vi.fn();
    renderLock({ onUnlocked });

    enterAndSubmit('0000');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not recognised|not recognized/i);
    expect(setToken).not.toHaveBeenCalled();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('says so when the PIN is locked out, rather than inviting another try', async () => {
    till.mockRejectedValueOnce(
      new ApiClientError(401, 'locked', undefined, { code: 'PIN_LOCKED' })
    );
    renderLock();

    enterAndSubmit('4821');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/locked/i);
    expect(setToken).not.toHaveBeenCalled();
  });

  it('tells the shift query the till is signed on, so the pad can come down', async () => {
    // The bug this guards: POS decides whether to cover itself with this
    // screen from `useCurrentShift`, and that query is 15 seconds stale and
    // holding the `null` that put the pad up in the first place. Signing on
    // mints a session and opens a shift server-side, but nothing told the
    // cache — so at the mount POS owns (a cashier signs out, the next one
    // signs on) the correct PIN was accepted and the screen simply stayed,
    // which reads as the pad doing nothing at all.
    //
    // `RequireTill`'s mount hid this: it swaps in a freshly mounted POS whose
    // query starts empty and fetches for real.
    till.mockResolvedValueOnce(session);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderLock({}, client);

    enterAndSubmit('112358');

    await waitFor(() => expect(setToken).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['registers', 'reg-1', 'currentShift'] })
      )
    );
  });

  it('names no register when it has not been told one', () => {
    // The front-door mount has no session yet, so nothing can tell it which
    // till this is. It must still render rather than showing "undefined".
    renderLock();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Register locked');
    expect(dialog.textContent).not.toMatch(/undefined/i);
  });
});
