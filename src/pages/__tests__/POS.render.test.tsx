import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Where the header buttons actually navigate.
 *
 * The Admin button called `navigate('/login')`. It sent every cashier to the
 * sign-in page instead of the dashboard, and since nothing had set `?next=`,
 * signing in returned them to the register — so the button appeared to do
 * nothing but make you log in again. Nothing caught it: it typechecks, it
 * renders, and a render test that only asserts the button exists says the same
 * about a button pointing anywhere.
 */
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
import type { Product } from '@/lib/api';

/**
 * The register renders, and the money on screen is the money the math says.
 *
 * This file exists because of two defects this project shipped past its whole
 * unit suite. A CORS failure on a same-origin POST and a temporal-dead-zone
 * crash — the cash-tender memos were declared above the `calculateTotals` they
 * called, so the first paint threw and the register replaced itself with an
 * error boundary. Typecheck passed. The production build passed. All 241 unit
 * tests passed. The screen was broken for every cashier.
 *
 * Nothing here asserts on styling or layout. It asserts that this component
 * mounts, paints, and shows arithmetic that agrees with `register-math` — the
 * class of failure that costs a shop its morning.
 */

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

const refetchProducts = vi.fn();
const mutateAsync = vi.fn(async () => ({ id: 'o1', total: 0 }));

const productsQuery = {
  data: PRODUCTS,
  isPending: false,
  isError: false,
  error: null,
  refetch: refetchProducts,
};

const DEFAULT_SETTINGS = {
  storeName: 'Corner Store',
  taxRateDefault: 0.1,
  logoUrl: null,
  config: {},
};

const settingsQuery = { data: { ...DEFAULT_SETTINGS } };

vi.mock('@/hooks/queries', () => ({
  useProducts: () => productsQuery,
  useSettings: () => settingsQuery,
  useCreateOrder: () => ({ mutateAsync, isPending: false }),
  // The register switcher in the POS header reads this. An empty list is the
  // honest default here: this suite covers first paint, and a store that has
  // not finished setup has no registers yet — the header must still render.
  useRegisters: () => ({ data: [], isLoading: false, isError: false }),
  // No register selected in this suite (nothing has written to
  // `register-device.ts`'s localStorage key), so the shift/lock-screen gate
  // in POS.tsx never activates — this just has to exist for the hook call.
  useRegister: () => ({ data: undefined }),
  useCurrentShift: () => ({ data: undefined, isPending: false }),
  useEndShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Only the network-calling members are replaced. `calculateVariantPrice` and the
// types stay real, because the price a variant shows is part of what is under
// test here.
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

const POS = (await import('../POS')).default;

function renderRegister() {
  // The query hooks POS itself uses are mocked above; this client is here for
  // the child dialogs that reach for `useQueryClient` directly.
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
  settingsQuery.data = { ...DEFAULT_SETTINGS };
});

describe('POS first paint', () => {
  it('mounts without throwing', async () => {
    // The TDZ crash surfaced exactly here: the component threw during its first
    // render and React unmounted it into an error boundary.
    expect(() => renderRegister()).not.toThrow();

    // Settle the quick-discount load the register kicks off on mount, so its
    // state update lands inside the test rather than as an act() warning on
    // the next one.
    await screen.findByText('Blue Shirt');
  });

  it('paints the store name from settings', async () => {
    renderRegister();

    expect(await screen.findByText('Corner Store')).toBeInTheDocument();
  });

  it('paints the catalog', async () => {
    renderRegister();

    expect(await screen.findByText('Blue Shirt')).toBeInTheDocument();
  });

  it('logs no React error and leaves no error boundary behind', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderRegister();
    await screen.findByText('Blue Shirt');

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('the checkout dialog totals', () => {
  async function openCheckoutWithOneItem() {
    renderRegister();

    fireEvent.click(await screen.findByText('Blue Shirt'));
    await screen.findByText('Current Order');
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));

    return screen.findByRole('dialog');
  }

  /** The `<span>label</span><span>amount</span>` row for a given label. */
  const row = (dialog: HTMLElement, label: string) =>
    within(dialog).getByText(label).parentElement;

  it('shows the subtotal', async () => {
    const dialog = await openCheckoutWithOneItem();

    expect(row(dialog, 'Subtotal')).toHaveTextContent('$20.00');
  });

  it('shows the tax the store charges', async () => {
    // A $20 sale at the store's configured 10% rate is $2.00 of tax. The
    // dialog had no tax row at all, so the figure a cashier confirmed was
    // silently pre-tax.
    const dialog = await openCheckoutWithOneItem();

    expect(row(dialog, 'Tax')).toHaveTextContent('$2.00');
  });

  it('totals to what the customer is actually charged', async () => {
    // The headline Total was `subtotal - discount`, dropping tax entirely,
    // while the order posted to the server included it. With tax configured
    // the cashier read $20.00 and the customer paid $22.00.
    const dialog = await openCheckoutWithOneItem();

    expect(row(dialog, 'Total')).toHaveTextContent('$22.00');
  });

  it('does not show a tax row when the store charges none', async () => {
    settingsQuery.data = { ...settingsQuery.data, taxRateDefault: 0 };

    const dialog = await openCheckoutWithOneItem();

    expect(within(dialog).queryByText('Tax')).not.toBeInTheDocument();
    expect(row(dialog, 'Total')).toHaveTextContent('$20.00');
  });
});

describe('the register header', () => {
  it.each([
    ['Admin', '/admin'],
    ['Inventory', '/inventory'],
    ['Settings', '/settings'],
    ['Services', '/services'],
  ])('sends %s to %s', async (label, path) => {
    renderRegister();

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}$`, 'i') }));

    expect(navigate).toHaveBeenCalledWith(path);
  });

  it('does not send anyone to the login page', async () => {
    // The specific shape of the bug: a destination button routing to `/login`
    // looks like a permissions prompt and behaves like a dead end.
    renderRegister();

    for (const label of ['Admin', 'Inventory', 'Settings', 'Services']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}$`, 'i') }));
    }

    expect(navigate).not.toHaveBeenCalledWith('/login');
  });
});
