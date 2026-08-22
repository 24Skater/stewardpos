import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Product } from '@/lib/api';

/**
 * The acting-as banner, as it shows up on the POS itself.
 *
 * `ActingAsBanner` has its own test for what it says; these are about when POS
 * mounts it and what "End session" actually does. The failure that matters is
 * the banner appearing at an ordinary till, because it is a false claim about
 * who the sales belong to.
 */

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/components/register/OverridePrompt', () => ({ default: () => null }));
vi.mock('@/components/register/LockScreen', () => ({
  default: ({ displayCode }: { displayCode?: string }) => (
    <div data-testid="lock-screen">Locked: {displayCode}</div>
  ),
}));

vi.mock('@/lib/register-device', () => ({
  getSelectedRegisterId: () => 'reg-1',
  setSelectedRegisterId: vi.fn(),
  clearSelectedRegisterId: vi.fn(),
  subscribeToSelectedRegisterId: () => () => {},
  getDeviceToken: () => 'device-token-abc',
  setDeviceToken: vi.fn(),
  clearDeviceToken: vi.fn(),
}));

const PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: 'Blue Shirt',
    category: 'Apparel',
    basePrice: 20,
    variants: [
      { id: 'v1', productId: 'p1', size: 'M', color: 'Blue', stock: 5, priceDelta: 0, barcode: '111' },
    ],
  } as unknown as Product,
];

const endShiftMutateAsync = vi.fn(async () => ({ shift: {} }));

vi.mock('@/hooks/queries', () => ({
  useProducts: () => ({ data: PRODUCTS, isPending: false, isError: false, error: null, refetch: vi.fn() }),
  useSettings: () => ({ data: { storeName: 'Corner Store', taxRateDefault: 0, logoUrl: null, config: {} } }),
  useCreateOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegisters: () => ({ data: [], isLoading: false, isError: false }),
  useRegister: () => ({ data: { id: 'reg-1', displayCode: 'MAIN-01', requireSignIn: true, idleLockSeconds: 30 } }),
  useCurrentShift: () => ({ data: { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Admin User' } }, isPending: false }),
  useEndShift: () => ({ mutateAsync: endShiftMutateAsync, isPending: false }),
}));

/**
 * Stubbed rather than left real: the live hook fetches `/api/auth/session`,
 * gets a 401 from no server, and `api-client` responds by clearing the token —
 * which now clears the assumed-session record too, unmounting the very banner
 * under test.
 */
vi.mock('@/hooks/queries/useSession', () => ({
  useSession: () => ({
    data: {
      user: { id: 'u1', email: 'admin@demo.local', name: 'Admin User', roleIds: [], roles: [] },
      permissions: { reports: { read: true, write: false, delete: false } },
    },
    isPending: false,
  }),
  useInvalidateSession: () => vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    discountsApi: { types: { listForPos: vi.fn(async () => []) } },
    ordersApi: { quote: vi.fn(), list: vi.fn(async () => []), get: vi.fn() },
    storeCreditsApi: { get: vi.fn() },
    terminalApi: { charge: vi.fn(), status: vi.fn(), cancel: vi.fn() },
    drawerApi: { current: vi.fn(async () => null), open: vi.fn(), close: vi.fn() },
    returnsApi: { create: vi.fn(), list: vi.fn(async () => []) },
    adminApi: { getSettings: vi.fn(async () => ({})) },
  };
});

const { authStore, writeAssumedSession } = await import('@/lib/auth-store');
const POS = (await import('../POS')).default;

function renderRegister() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <POS />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('the acting-as banner', () => {
  it('is not shown at an ordinary till', async () => {
    renderRegister();

    await screen.findByText('Blue Shirt');
    expect(screen.queryByText(/recorded against/i)).not.toBeInTheDocument();
  });

  it('is shown for an assumed session, naming who is covered', async () => {
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam Cashier' });
    renderRegister();

    expect(await screen.findByText(/Admin User is covering Sam Cashier's till/)).toBeInTheDocument();
  });

  it('ends the shift and drops the session when the admin exits', async () => {
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam Cashier' });
    authStore.setToken('assumed-jwt', '30m');
    renderRegister();

    fireEvent.click(await screen.findByRole('button', { name: /end session/i }));

    await waitFor(() => expect(endShiftMutateAsync).toHaveBeenCalledWith('reg-1'));
    // The token outliving the exit is the hole: the backend rejects it once the
    // shift closes, but a client that keeps it walks back in past RequireTill
    // and gets a 401 at the first thing it touches instead of a lock screen.
    await waitFor(() => expect(authStore.getToken()).toBeNull());
  });

  it('leaves the admin at the till, not at a route their dropped token cannot reach', async () => {
    // Exiting used to navigate back to /admin/registers, which is where the
    // admin came from - but the token it drops on the way out IS their session:
    // assuming a till replaces the back-office one. RequireAuth then bounced
    // the tokenless browser to /login, stranding whoever is standing at the
    // register at a password prompt. Found by walking it in a browser.
    //
    // The till is where they already are, and POS puts its own lock screen up
    // as soon as the ended shift refetches - the same way an ordinary sign-out
    // does. So the exit navigates nowhere at all.
    writeAssumedSession({ adminName: 'Admin User', actingAs: 'Sam Cashier' });
    authStore.setToken('assumed-jwt', '30m');
    renderRegister();

    fireEvent.click(await screen.findByRole('button', { name: /end session/i }));

    await waitFor(() => expect(authStore.getToken()).toBeNull());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
