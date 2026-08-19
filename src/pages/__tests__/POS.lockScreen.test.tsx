import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Product } from '@/lib/api';

/**
 * Phase 4's cashier sign-on, as it shows up on the POS screen itself:
 *
 * - a register with `require_sign_in` and no open shift is covered by the
 *   lock screen, and one that is signed on shows who and offers sign-out
 * - a cart in progress is never discarded by locking, whether that lock
 *   comes from idle timeout or from checkout being refused with
 *   `SHIFT_REQUIRED`
 * - the idle timer actually wires up to the register's own `idleLockSeconds`
 *
 * `LockScreen` itself (masking, PIN_INVALID vs PIN_LOCKED messaging, focus
 * trapping) has its own test file; here it is stubbed to a simple marker so
 * these tests stay about POS's wiring, not LockScreen's internals.
 */

vi.mock('@/components/register/OverridePrompt', () => ({
  default: ({
    description,
    onOpenChange,
  }: {
    description: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="override-prompt">
      {description}
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </div>
  ),
}));

vi.mock('@/components/register/LockScreen', () => ({
  default: ({ displayCode, onSignedOn }: { displayCode: string; onSignedOn?: () => void }) => (
    <div data-testid="lock-screen">
      Locked: {displayCode}
      <button onClick={() => onSignedOn?.()}>Fake sign on</button>
    </div>
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

const productsQuery = {
  data: PRODUCTS,
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

const settingsQuery = {
  data: { storeName: 'Corner Store', taxRateDefault: 0, logoUrl: null, config: {} },
};

const REGISTER = {
  id: 'reg-1',
  displayCode: 'MAIN-01',
  requireSignIn: true,
  idleLockSeconds: 30,
};

let registerQueryData: typeof REGISTER | undefined = REGISTER;
let currentShiftData: { shift: unknown; cashier: { id: string; name: string } } | undefined | null = null;
let currentShiftPending = false;
const mutateAsync = vi.fn(async () => ({ id: 'o1', total: 0 }));
const endShiftMutateAsync = vi.fn(async () => ({ shift: {} }));

vi.mock('@/hooks/queries', () => ({
  useProducts: () => productsQuery,
  useSettings: () => settingsQuery,
  useCreateOrder: () => ({ mutateAsync, isPending: false }),
  useRegisters: () => ({ data: [], isLoading: false, isError: false }),
  useRegister: () => ({ data: registerQueryData }),
  useCurrentShift: () => ({ data: currentShiftData, isPending: currentShiftPending }),
  useEndShift: () => ({ mutateAsync: endShiftMutateAsync, isPending: false }),
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

const { ApiClientError } = await import('@/lib/api-client');
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
  registerQueryData = REGISTER;
  currentShiftData = null;
  currentShiftPending = false;
});

describe('the lock screen gate', () => {
  it('is shown when the register requires sign-in and no shift is open', async () => {
    renderRegister();

    expect(await screen.findByTestId('lock-screen')).toHaveTextContent('MAIN-01');
  });

  it('is not shown while the shift query is still pending, to avoid flashing over an already-open shift', async () => {
    currentShiftPending = true;
    renderRegister();

    await screen.findByText('Blue Shirt');
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });

  it('is not shown once a shift is open', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();

    await screen.findByText('Blue Shirt');
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });

  it('is not shown when the register does not require sign-in', async () => {
    registerQueryData = { ...REGISTER, requireSignIn: false };
    renderRegister();

    await screen.findByText('Blue Shirt');
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });

  it('does not cover the register with the cart underneath unmounted', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();
    await screen.findByText('Blue Shirt');

    fireEvent.click(screen.getByText('Blue Shirt'));
    await screen.findByText('Current Order');
    expect(screen.getAllByText('Blue Shirt').length).toBeGreaterThan(1);
  });
});

describe('who is on the till', () => {
  it('shows the cashier name once a shift is open', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();

    expect(await screen.findByText('Alex')).toBeInTheDocument();
  });

  it('offers sign-out, and calls it for the selected register', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Alex' }));

    await waitFor(() => expect(endShiftMutateAsync).toHaveBeenCalledWith('reg-1'));
  });

  it('does not show a cashier name when no shift is open', async () => {
    renderRegister();
    await screen.findByTestId('lock-screen');

    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });
});

describe('SHIFT_REQUIRED on checkout', () => {
  it('shows the lock screen instead of a generic failure, and keeps the cart', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(409, 'Register MAIN-01 requires a cashier to sign in with a PIN', undefined, {
        code: 'SHIFT_REQUIRED',
      })
    );
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
    // The cart survives - it was never cleared, unlike a real successful
    // checkout, which resets it.
    expect(screen.getAllByText('Blue Shirt').length).toBeGreaterThan(0);
  });

  it('closes the checkout dialog rather than leaving it open over the lock screen', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(409, 'Sign in required', undefined, { code: 'SHIFT_REQUIRED' })
    );
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    await screen.findByTestId('lock-screen');
    expect(screen.queryByText('Complete Sale')).not.toBeInTheDocument();
  });

  it('does not show the lock screen for an unrelated checkout failure', async () => {
    // An ordinary failure (stock, a declined discount, ...) is a ordinary
    // toast, not a sign-in prompt - only a SHIFT_REQUIRED code triggers the
    // lock screen.
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(new Error('Only 2 left in stock'));
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
    // Unlike the SHIFT_REQUIRED path, the checkout dialog itself stays open
    // so the cashier can see what went wrong and retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('idle lock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks the register after idleLockSeconds of inactivity', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();
    await screen.findByText('Blue Shirt');
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
  });

  it('a genuine interaction postpones the idle lock', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    renderRegister();
    await screen.findByText('Blue Shirt');

    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });
});

describe('OVERRIDE_REQUIRED on checkout', () => {
  it('prompts for a supervisor override and keeps the cart', async () => {
    // The property that matters: a cashier who has scanned items and needs a
    // discount approved must not lose them to the round trip. Losing the cart
    // would make the override worse than logging a supervisor in, which is the
    // workflow it exists to replace.
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(409, 'This discount needs a supervisor override', undefined, {
        code: 'OVERRIDE_REQUIRED',
        data: { action: 'discount_approval' },
      })
    );
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    expect(await screen.findByTestId('override-prompt')).toBeInTheDocument();
    expect(screen.getAllByText('Blue Shirt').length).toBeGreaterThan(0);
  });

  it('leaves the cart alone when the supervisor cancels', async () => {
    // Declining is a legitimate answer, not an error path, and it must not
    // cost the sale.
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(
      new ApiClientError(409, 'Needs approval', undefined, {
        code: 'OVERRIDE_REQUIRED',
        data: { action: 'discount_approval' },
      })
    );
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    const prompt = await screen.findByTestId('override-prompt');
    fireEvent.click(within(prompt).getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('override-prompt')).not.toBeInTheDocument();
    expect(screen.getAllByText('Blue Shirt').length).toBeGreaterThan(0);
  });

  it('does not prompt for an unrelated checkout failure', async () => {
    currentShiftData = { shift: { id: 's1' }, cashier: { id: 'u1', name: 'Alex' } };
    mutateAsync.mockRejectedValueOnce(new Error('Only 2 left in stock'));
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Complete Sale/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(screen.queryByTestId('override-prompt')).not.toBeInTheDocument();
  });
});
