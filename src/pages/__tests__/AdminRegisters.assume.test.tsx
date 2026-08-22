import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { ApiClientError } from '@/lib/api-client';

/**
 * Opening a till from the back office — the only path to a till session that
 * skips the device credential, and the only way to reach
 * `POST /api/auth/till/assume` at all.
 *
 * Two things must happen together or not at all: the token is stored, and the
 * assumed-session record is written. A token without the record puts an admin
 * on a till with no banner telling them their name is on every sale.
 */

const { assumeTill, setToken, writeAssumedSession, navigate } = vi.hoisted(() => ({
  assumeTill: vi.fn(),
  setToken: vi.fn(),
  writeAssumedSession: vi.fn(),
  navigate: vi.fn(),
}));

const REGISTER = {
  id: 'r1',
  orgId: 'org1',
  locationId: 'loc1',
  name: 'Front Counter',
  registerNumber: 1,
  displayCode: 'MAIN-01',
  placement: null,
  type: 'fixed' as const,
  hasCashDrawer: true,
  acceptsCash: true,
  canRefund: true,
  canOpenDrawerNoSale: false,
  requireSignIn: true,
  idleLockSeconds: 300,
  terminalProvider: null,
  terminalDeviceId: null,
  status: 'active' as const,
  lastSeenAt: null,
  createdAt: 0,
  updatedAt: 0,
  locationName: 'Main Location',
};

const RETIRED = {
  ...REGISTER,
  id: 'r2',
  displayCode: 'MAIN-02',
  registerNumber: 2,
  status: 'retired' as const,
};

const LOCATION = {
  id: 'loc1',
  orgId: 'org1',
  name: 'Main Location',
  slug: 'main',
  address: null,
  city: null,
  state: null,
  zip: null,
  timezone: 'UTC',
  status: 'active' as const,
  createdAt: 0,
  updatedAt: 0,
  registerCount: 2,
};

vi.mock('@/lib/api', () => ({
  authApi: { assumeTill },
  registersApi: {
    list: vi.fn(async () => [REGISTER, RETIRED]),
    get: vi.fn(async () => REGISTER),
    create: vi.fn(),
    update: vi.fn(),
    retire: vi.fn(),
    disable: vi.fn(),
    activate: vi.fn(),
    pairingCode: vi.fn(),
    pair: vi.fn(),
    heartbeat: vi.fn(),
    revoke: vi.fn(),
  },
  locationsApi: {
    list: vi.fn(async () => [LOCATION]),
    get: vi.fn(async () => LOCATION),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/auth-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authStore: { ...(actual.authStore as object), setToken },
    writeAssumedSession,
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigate };
});

/** A signed-in administrator — `hasPermission` short-circuits true for `systemRole: 'admin'`. */
const ADMIN_SESSION = {
  user: {
    id: 'u1',
    email: 'admin@demo.local',
    name: 'Admin User',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  },
  permissions: {},
};

vi.mock('@/hooks/queries/useSession', () => ({
  useSession: () => ({ data: ADMIN_SESSION, isPending: false }),
  useInvalidateSession: () => vi.fn(),
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock('@/components/ProtectedRoute', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderPage(Page: ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

const TIMEOUT = 20_000;

describe('assuming a register', () => {
  it('opens the till and goes to the register', async () => {
    assumeTill.mockResolvedValue({
      token: 'jwt',
      expiresIn: '1800s',
      register: { id: 'r1', name: 'Front Counter' },
      actingAs: null,
      shift: { id: 's1' },
    });
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /Open MAIN-01/i }));

    await waitFor(() => expect(assumeTill).toHaveBeenCalledWith({ registerId: 'r1' }));
    expect(setToken).toHaveBeenCalledWith('jwt', '1800s');
    expect(navigate).toHaveBeenCalledWith('/pos');
  }, TIMEOUT);

  it('records who is being covered so the banner can say so', async () => {
    assumeTill.mockResolvedValue({
      token: 'jwt',
      expiresIn: '1800s',
      register: { id: 'r1', name: 'Front Counter' },
      actingAs: { id: 'u9', name: 'Sam Cashier' },
      shift: { id: 's1' },
    });
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /Open MAIN-01/i }));

    await waitFor(() =>
      expect(writeAssumedSession).toHaveBeenCalledWith({
        adminName: 'Admin User',
        actingAs: 'Sam Cashier',
      })
    );
  }, TIMEOUT);

  it('records the admin alone when no cashier is being covered', async () => {
    assumeTill.mockResolvedValue({
      token: 'jwt',
      expiresIn: '1800s',
      register: { id: 'r1', name: 'Front Counter' },
      actingAs: null,
      shift: null,
    });
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /Open MAIN-01/i }));

    await waitFor(() =>
      expect(writeAssumedSession).toHaveBeenCalledWith({ adminName: 'Admin User', actingAs: null })
    );
  }, TIMEOUT);

  it('stores nothing when the server refuses', async () => {
    // A half-applied assume is the bad state: a token with no banner, or a
    // banner over a session that was never opened.
    assumeTill.mockRejectedValue(new ApiClientError(403, 'Forbidden'));
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /Open MAIN-01/i }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(setToken).not.toHaveBeenCalled();
    expect(writeAssumedSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('offers no way to open a retired register', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    await screen.findByText('MAIN-02');
    expect(screen.queryByRole('button', { name: /Open MAIN-02/i })).not.toBeInTheDocument();
  }, TIMEOUT);
});
