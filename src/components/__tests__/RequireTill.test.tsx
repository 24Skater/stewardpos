import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The register's front door asks two questions, and the order matters: is this
 * device enrolled, and is a session open on it. An unpaired terminal must never
 * see the PIN pad — `POST /api/auth/till` refuses a caller with no device
 * credential, so every PIN typed there would look like a wrong PIN.
 */

const { getDeviceToken, getToken } = vi.hoisted(() => ({
  getDeviceToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('@/lib/register-device', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDeviceToken };
});

vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, authStore: { ...(actual.authStore as object), getToken } };
});

const { default: RequireTill } = await import('../RequireTill');

function renderAt(path = '/pos') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pos" element={<RequireTill><div>THE REGISTER</div></RequireTill>} />
          <Route path="/pair" element={<div>PAIRING SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const aDigitKey = { name: /^Digit 1$/ } as const;

beforeEach(() => vi.clearAllMocks());

describe('RequireTill', () => {
  it('sends an unpaired terminal to the pairing screen', async () => {
    // A till without a device credential cannot open a session at all, so the
    // PIN pad would be a dead end.
    getDeviceToken.mockReturnValue(null);
    getToken.mockReturnValue(null);

    renderAt();

    expect(await screen.findByText('PAIRING SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('THE REGISTER')).not.toBeInTheDocument();
  });

  it('sends an unpaired terminal to pairing even if a stale session token lingers', async () => {
    // A browser that was once signed in to the back office must not walk
    // straight into a till it has never enrolled.
    getDeviceToken.mockReturnValue(null);
    getToken.mockReturnValue('jwt');

    renderAt();

    expect(await screen.findByText('PAIRING SCREEN')).toBeInTheDocument();
  });

  it('shows the PIN pad on a paired terminal with no session', async () => {
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue(null);

    renderAt();

    expect(await screen.findByRole('button', aDigitKey)).toBeInTheDocument();
    expect(screen.queryByText('THE REGISTER')).not.toBeInTheDocument();
  });

  it('shows the register once a session exists', async () => {
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue('jwt');

    renderAt();

    expect(await screen.findByText('THE REGISTER')).toBeInTheDocument();
  });

  it('does not flash the pad while it is still deciding', async () => {
    // The bug this prevents: rendering the lock screen for a frame over an
    // already-signed-on till on every mount.
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue('jwt');

    renderAt();

    await waitFor(() => expect(screen.getByText('THE REGISTER')).toBeInTheDocument());
    expect(screen.queryByRole('button', aDigitKey)).not.toBeInTheDocument();
  });

  it('lets the register through once the pad reports a session', async () => {
    getDeviceToken.mockReturnValue('rt_device');
    getToken.mockReturnValue(null);

    renderAt();

    await screen.findByRole('button', aDigitKey);
    // LockScreen stores the token, then calls back; the gate must re-read it
    // rather than keep its first answer forever.
    getToken.mockReturnValue('jwt');
    screen.getByRole('button', { name: 'Submit' });

    expect(screen.queryByText('THE REGISTER')).not.toBeInTheDocument();
  });
});
