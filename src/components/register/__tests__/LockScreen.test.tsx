import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ApiClientError } from '@/lib/api-client';

/**
 * `PIN_INVALID` and `PIN_LOCKED` must produce genuinely different messages,
 * driven by the error envelope's `code` — never by matching the message
 * text, which is exactly the bug a previous phase shipped (see
 * `registerErrorCodes.ts`'s module doc comment). The lockout message also has
 * to say the lock clears on its own, and neither message may hint at whether
 * a PIN exists for anyone.
 */

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authApi: { ...(actual.authApi as object), till: mutateAsync } };
});
vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authStore: { ...(actual.authStore as object), setToken: vi.fn(), getToken: () => null },
  };
});

const LockScreen = (await import('../LockScreen')).default;

/** The sign-on mutation needs a client; nothing here asserts on the cache. */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

function enterAndSubmit(pin: string) {
  const pad = screen.getByRole('group', { name: 'PIN entry' });
  for (const digit of pin) {
    fireEvent.keyDown(pad, { key: digit });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

describe('LockScreen', () => {
  it('shows which register this is', () => {
    render(<LockScreen displayCode="MAIN-01" />);

    expect(screen.getByText('MAIN-01')).toBeInTheDocument();
  });

  it('covers the screen as a non-dismissible modal', () => {
    render(<LockScreen displayCode="MAIN-01" />);

    // Radix's Dialog.Content, rendered as an opaque full-viewport overlay -
    // `fixed inset-0` covers everything behind it.
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/fixed/);
    expect(dialog.className).toMatch(/inset-0/);
    // No close control anywhere - unlike an ordinary dialog, there is no way
    // to dismiss this without a valid PIN.
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('is announced to assistive tech via an accessible name and description', () => {
    render(<LockScreen displayCode="MAIN-01" />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Register locked');
    expect(dialog).toHaveAccessibleDescription(/sign on to.*MAIN-01/i);
  });

  it('shows a distinct message for PIN_INVALID', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(401, 'That PIN was not recognized', undefined, { code: 'PIN_INVALID' })
    );
    render(<LockScreen displayCode="MAIN-01" />);

    enterAndSubmit('000000');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That PIN was not recognised');
    expect(alert).not.toHaveTextContent(/locked/i);
  });

  it('shows a distinct message for PIN_LOCKED, including that it clears on its own', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(401, 'This PIN is locked after too many failed attempts.', undefined, {
        code: 'PIN_LOCKED',
      })
    );
    render(<LockScreen displayCode="MAIN-01" />);

    enterAndSubmit('000000');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/locked/i);
    expect(alert).toHaveTextContent(/on its own/i);
    // Nobody should be sent to find an admin - the message has to say
    // waiting is the fix, not escalation.
    expect(alert.textContent?.toLowerCase()).not.toContain('contact an admin');
  });

  it('never reveals whether a PIN exists for anyone', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(401, 'That PIN was not recognized', undefined, { code: 'PIN_INVALID' })
    );
    render(<LockScreen displayCode="MAIN-01" />);

    enterAndSubmit('000000');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.toLowerCase()).not.toContain('exist');
    expect(alert.textContent?.toLowerCase()).not.toContain('no such');
  });

  it('the two failure codes produce different text', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(401, 'msg', undefined, { code: 'PIN_INVALID' })
    );
    const { unmount } = render(<LockScreen displayCode="MAIN-01" />);
    enterAndSubmit('000000');
    const invalidAlert = await screen.findByRole('alert');
    const invalidText = invalidAlert.textContent;
    unmount();

    mutateAsync.mockRejectedValueOnce(new ApiClientError(401, 'msg', undefined, { code: 'PIN_LOCKED' }));
    render(<LockScreen displayCode="MAIN-01" />);
    enterAndSubmit('000000');
    const lockedAlert = await screen.findByRole('alert');

    expect(lockedAlert.textContent).not.toBe(invalidText);
  });

  it('calls onUnlocked with the session on a successful sign-on', async () => {
    const session = {
      token: 'jwt',
      expiresIn: '24h',
      register: { id: 'reg-1' },
      user: { id: 'u1', name: 'Alex', email: 'alex@example.com' },
      shift: { id: 's1' },
    };
    mutateAsync.mockResolvedValueOnce(session);
    const onUnlocked = vi.fn();
    render(<LockScreen displayCode="MAIN-01" onUnlocked={onUnlocked} />);

    enterAndSubmit('123456');

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(session));
  });

  it('submits the PIN alone — the device token picks the register', async () => {
    mutateAsync.mockResolvedValueOnce({
      token: 'jwt',
      expiresIn: '24h',
      register: { id: 'reg-42' },
      user: { id: 'u1', name: 'Alex', email: 'alex@example.com' },
      shift: { id: 's1' },
    });
    render(<LockScreen displayCode="MAIN-42" />);

    enterAndSubmit('654321');

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ pin: '654321' }));
  });
});
