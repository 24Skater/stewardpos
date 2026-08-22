import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';

/**
 * A cashier who types a correct password into the back-office form must be
 * told where their door actually is. "Invalid credentials" would be both untrue
 * and actively unhelpful — they would keep retyping a password that works.
 *
 * The branch is on the envelope's `code`, never on the message text, for the
 * reason `register-error-codes.ts` sets out.
 */

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authApi: { ...(actual.authApi as object), login } };
});

const { default: Login } = await import('../Login');

function renderLogin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function submit() {
  fireEvent.change(await screen.findByLabelText(/email/i), {
    target: { value: 'cashier@demo.local' },
  });
  fireEvent.change(await screen.findByLabelText(/password/i), { target: { value: 'pw' } });
  fireEvent.click(await screen.findByRole('button', { name: /sign in/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('Login', () => {
  it('points a cashier at the till instead of showing a credentials error', async () => {
    login.mockRejectedValue(
      new ApiClientError(403, 'Use your PIN at the till.', undefined, { code: 'USE_PIN_AT_TILL' })
    );
    renderLogin();

    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/PIN at the till/i);
    expect(alert).not.toHaveTextContent(/invalid credentials/i);
  });

  it('does not blame the password it just accepted', async () => {
    login.mockRejectedValue(
      new ApiClientError(403, 'Use your PIN at the till.', undefined, { code: 'USE_PIN_AT_TILL' })
    );
    renderLogin();

    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.toLowerCase()).not.toContain('password');
  });

  it('still shows an ordinary failure as one', async () => {
    login.mockRejectedValue(new ApiClientError(401, 'Invalid credentials'));
    renderLogin();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid credentials/i);
  });

  it('clears a previous failure when the form is submitted again', async () => {
    login.mockRejectedValueOnce(new ApiClientError(401, 'Invalid credentials'));
    renderLogin();

    await submit();
    await screen.findByRole('alert');

    login.mockReturnValue(new Promise(() => {}));
    await submit();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
