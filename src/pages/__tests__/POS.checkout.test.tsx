import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { CreateOrderRequest, Product } from '@/lib/api';

/**
 * The register from scan to receipt: what a cashier rings up, what the
 * customer is told they owe, and what is actually sent to the server.
 *
 * Setup follows POS.render.test.tsx — the query hooks and the network members
 * of `@/lib/api` are stubbed, `register-math` stays real, because the figures
 * on screen are the thing under test. A register id is selected (so the
 * supervisor-override prompt can mount) but no device token is paired, so the
 * shift/lock-screen gate stays off; POS.lockScreen.test.tsx covers that.
 */

vi.mock('@/lib/register-device', () => ({
  getSelectedRegisterId: () => 'reg-1',
  setSelectedRegisterId: vi.fn(),
  clearSelectedRegisterId: vi.fn(),
  subscribeToSelectedRegisterId: () => () => {},
  getDeviceToken: () => null,
  setDeviceToken: vi.fn(),
  clearDeviceToken: vi.fn(),
}));

vi.mock('@/components/register/OverridePrompt', () => ({
  default: ({
    description,
    onGranted,
    onOpenChange,
  }: {
    description: string;
    onGranted: (grant: { token: string }) => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="override-prompt">
      {description}
      <button onClick={() => onGranted({ token: 'grant-tok' })}>Grant</button>
      <button onClick={() => onOpenChange(false)}>Deny</button>
    </div>
  ),
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

function variant(over: Record<string, unknown>) {
  return { productId: 'x', priceDelta: 0, enabled: true, stock: 5, ...over };
}

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Blue Shirt',
    category: 'Apparel',
    basePrice: 20,
    barcode: '400100',
    variants: [variant({ id: 'v1', size: 'M', color: 'Blue', stock: 5, barcode: '111' })],
  },
  {
    id: 'p2',
    name: 'Hoodie',
    category: 'Outerwear',
    basePrice: 40,
    variants: [
      variant({ id: 'h-s', size: 'S', color: 'Black', stock: 3 }),
      variant({ id: 'h-l', size: 'L', color: 'Black', stock: 1, priceDelta: 5 }),
    ],
  },
  {
    id: 'p3',
    name: 'Old Cap',
    category: 'Accessories',
    basePrice: 10,
    variants: [variant({ id: 'c1', stock: 0, barcode: '999' })],
  },
] as unknown as Product[];

const productsQuery: {
  data: Product[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
} = { data: PRODUCTS, isPending: false, isError: false, error: null, refetch: vi.fn() };

const DEFAULT_SETTINGS = { storeName: 'Corner Store', taxRateDefault: 0.1, logoUrl: null, config: {} };
const settingsQuery: { data: Record<string, unknown> } = { data: { ...DEFAULT_SETTINGS } };

const mutateAsync = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useProducts: () => productsQuery,
  useSettings: () => settingsQuery,
  useCreateOrder: () => ({ mutateAsync, isPending: false }),
  useRegisters: () => ({ data: [], isLoading: false, isError: false }),
  useRegister: () => ({ data: undefined }),
  useCurrentShift: () => ({ data: undefined, isPending: false }),
  useEndShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/queries/useSession', () => ({
  useSession: () => ({ data: undefined }),
  useInvalidateSession: () => vi.fn(),
}));

const listForPos = vi.fn();
const validatePromo = vi.fn();
const getCredit = vi.fn();
const charge = vi.fn();
const chargeStatus = vi.fn();
const cancelCharge = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    discountsApi: { types: { listForPos: () => listForPos() }, promos: { validate: (b: unknown) => validatePromo(b) } },
    ordersApi: { quote: vi.fn(), list: vi.fn(async () => []), get: vi.fn() },
    storeCreditsApi: { get: (code: string) => getCredit(code) },
    terminalApi: {
      charge: (b: unknown) => charge(b),
      status: (id: string) => chargeStatus(id),
      cancel: (id: string) => cancelCharge(id),
    },
    drawerApi: { current: vi.fn(async () => null), open: vi.fn(), close: vi.fn() },
    returnsApi: { create: vi.fn(), list: vi.fn(async () => []) },
    adminApi: { settings: { get: vi.fn(async () => ({})) } },
  };
});

const { ApiClientError } = await import('@/lib/api-client');
const POS = (await import('../POS')).default;

const QUICK_DISCOUNTS = [
  { id: 'd1', name: 'Staff', code: 'STAFF', discountType: 'percentage', discountValue: 10, icon: 'user', color: 'blue' },
  { id: 'd2', name: 'Buy One', code: 'BOGO', discountType: 'buy_x_get_y', discountValue: 100, color: 'green' },
  { id: 'd3', name: 'Five Off', code: 'FIVE', discountType: 'fixed', discountValue: 5, color: 'red' },
];

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

const productTile = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name},`) });

async function addShirt(times = 1) {
  const tile = await productTile('Blue Shirt');
  for (let i = 0; i < times; i++) fireEvent.click(tile);
}

async function openCheckout(times = 1) {
  renderRegister();
  await addShirt(times);
  fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
  return screen.findByRole('dialog');
}

const row = (dialog: HTMLElement, label: string) => within(dialog).getByText(label).parentElement;
const completeSale = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: /complete sale/i }));
const plainApply = (dialog: HTMLElement) =>
  within(dialog).getAllByRole('button', { name: /^apply$/i }).find(b => !b.dataset.testid)!;
const submittedOrder = (call = 0) =>
  (mutateAsync.mock.calls[call][0] as { body: CreateOrderRequest; overrideToken?: string });
const toastTitled = (title: string) => expect.objectContaining({ title });

function serverOrder(over: Record<string, unknown> = {}) {
  return { id: 'order-abc12345', subtotal: 20, discountTotal: 0, taxTotal: 2, total: 22, items: [], ...over };
}

function apiError(code: string, data?: Record<string, unknown>) {
  return new ApiClientError(403, 'Refused', undefined, { code, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  productsQuery.data = PRODUCTS;
  productsQuery.isPending = false;
  productsQuery.isError = false;
  productsQuery.error = null;
  settingsQuery.data = { ...DEFAULT_SETTINGS };
  listForPos.mockResolvedValue(QUICK_DISCOUNTS);
  mutateAsync.mockResolvedValue(serverOrder());
});

describe('the catalog', () => {
  it('says it is loading while the catalog is still on its way', () => {
    productsQuery.isPending = true;
    productsQuery.data = undefined;

    renderRegister();

    expect(screen.getByText('Loading catalog…')).toBeInTheDocument();
  });

  it('explains a failed catalog load and lets the cashier retry', () => {
    productsQuery.isError = true;
    productsQuery.data = undefined;
    productsQuery.error = new Error('Product service is down');

    renderRegister();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Catalog unavailable')).toBeInTheDocument();
    expect(screen.getByText('Product service is down')).toBeInTheDocument();
    expect(productsQuery.refetch).toHaveBeenCalled();
  });

  it('tells a new store its catalog is empty', () => {
    productsQuery.data = [];

    renderRegister();

    expect(screen.getByText('No products in the catalog yet')).toBeInTheDocument();
  });

  it('filters by search text and says so when nothing matches', async () => {
    renderRegister();
    const search = screen.getByPlaceholderText('Search products or scan barcode...');

    fireEvent.change(search, { target: { value: 'hood' } });
    expect(await productTile('Hoodie')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Blue Shirt,/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No products found')).toBeInTheDocument();
    expect(screen.getByText('Try a different search or category')).toBeInTheDocument();
  });

  it('matches a product by its own barcode in the search box', async () => {
    renderRegister();

    fireEvent.change(screen.getByPlaceholderText('Search products or scan barcode...'), {
      target: { value: '400100' },
    });

    expect(await productTile('Blue Shirt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hoodie,/ })).not.toBeInTheDocument();
  });

  it('matches an alphanumeric product barcode typed exactly as printed', async () => {
    productsQuery.data = [{ ...PRODUCTS[0], barcode: 'SHIRT-01' }, PRODUCTS[1]];
    renderRegister();

    fireEvent.change(screen.getByPlaceholderText('Search products or scan barcode...'), {
      target: { value: 'SHIRT-01' },
    });

    expect(screen.queryByRole('button', { name: /^Hoodie,/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Blue Shirt,/ })).toBeInTheDocument();
  });

  it('shows only the chosen category', async () => {
    renderRegister();

    fireEvent.click(screen.getAllByText('Outerwear')[0]);

    expect(await productTile('Hoodie')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Blue Shirt,/ })).not.toBeInTheDocument();
  });
});

describe('the barcode scanner', () => {
  function scan(code: string) {
    fireEvent.change(screen.getByPlaceholderText(/Scan or enter barcode/), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
  }

  it('adds the scanned variant to the order and clears the field', async () => {
    renderRegister();
    await productTile('Blue Shirt');

    scan('111');

    expect(await screen.findByRole('button', { name: 'Remove Blue Shirt from the order' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Scan or enter barcode/)).toHaveValue('');
  });

  it('warns when the barcode matches nothing', async () => {
    renderRegister();

    scan('000');

    expect(toastSpy).toHaveBeenCalledWith(toastTitled('Product not found'));
  });

  it('refuses to add an item with no stock', async () => {
    renderRegister();

    scan('999');

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Out of stock')));
    expect(screen.queryByRole('button', { name: /Remove Old Cap/ })).not.toBeInTheDocument();
  });

  it('ignores an empty scan', async () => {
    renderRegister();

    scan('   ');

    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('puts focus in the scanner when "/" is pressed outside a field', async () => {
    renderRegister();
    const scanner = screen.getByPlaceholderText(/Scan or enter barcode/);
    scanner.blur();

    fireEvent.keyDown(window, { key: '/' });

    expect(scanner).toHaveFocus();
  });
});

describe('the order in progress', () => {
  it('counts repeat taps as quantity, priced into the subtotal', async () => {
    const dialog = await openCheckout(2);

    expect(row(dialog, 'Subtotal')).toHaveTextContent('$40.00');
  });

  it('will not sell more than the variant has in stock', async () => {
    renderRegister();

    await addShirt(6);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stock limit reached', description: 'Only 5 available.' })
    );
  });

  it('stops the + button at the stock level too', async () => {
    renderRegister();
    await addShirt(5);

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Blue Shirt' }));

    expect(toastSpy).toHaveBeenCalledWith(toastTitled('Stock limit'));
  });

  it('raises and lowers quantity, removing the line at zero', async () => {
    renderRegister();
    await addShirt();

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Blue Shirt' }));
    expect(screen.getByRole('button', { name: 'Cart (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Blue Shirt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Blue Shirt' }));

    expect(screen.queryByRole('button', { name: /Remove Blue Shirt/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cart (0)' })).toBeInTheDocument();
  });

  it('removes a line outright', async () => {
    renderRegister();
    await addShirt();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Blue Shirt from the order' }));

    expect(screen.queryByRole('button', { name: /Remove Blue Shirt/ })).not.toBeInTheDocument();
  });

  it('does not open checkout with an empty order', async () => {
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: 'Cart (0)' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks which size when a product has a real choice, and prices the one picked', async () => {
    renderRegister();
    fireEvent.click(await productTile('Hoodie'));

    const picker = await screen.findByRole('dialog');
    fireEvent.click(within(picker).getByRole('button', { name: 'L' }));
    expect(within(picker).getByText('$45.00')).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: /add to cart/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    expect(row(await screen.findByRole('dialog'), 'Subtotal')).toHaveTextContent('$45.00');
  });
});

describe('completing a cash sale', () => {
  it('submits the order the cashier rang up, with tax and the cash handed over', async () => {
    const dialog = await openCheckout(2);

    fireEvent.change(within(dialog).getByPlaceholderText('Amount received'), { target: { value: '50' } });
    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const { body, overrideToken } = submittedOrder();
    expect(overrideToken).toBeUndefined();
    expect(body).toMatchObject({
      subtotal: 40,
      discountTotal: 0,
      taxTotal: 4,
      total: 44,
      paymentMethod: 'Cash',
      cashTendered: 50,
      appliedDiscounts: [],
    });
    expect(body.items).toEqual([
      {
        productId: 'p1',
        variantId: 'v1',
        nameSnapshot: 'Blue Shirt',
        quantity: 2,
        unitPrice: 20,
        lineDiscount: 0,
        lineTotal: 40,
        size: 'M',
        color: 'Blue',
      },
    ]);
    expect(body).not.toHaveProperty('customerEmail');
    expect(body).not.toHaveProperty('payments');
  });

  it('attaches the customer email, trimmed, when one is given', async () => {
    const dialog = await openCheckout();

    fireEvent.mouseDown(within(dialog).getByRole('tab', { name: /customer/i }));
    fireEvent.change(await within(dialog).findByPlaceholderText(/customer@example.com/), {
      target: { value: '  pat@example.com  ' },
    });
    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body.customerEmail).toBe('pat@example.com');
  });

  it('shows the receipt with what the server recorded and empties the order', async () => {
    // The server's total differs from the screen's on purpose: the receipt
    // has to match the sale that was stored, not the one the till computed.
    mutateAsync.mockResolvedValue(serverOrder({ total: 21.5 }));
    const dialog = await openCheckout();

    completeSale(dialog);

    const receipt = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(receipt).getByText(/Order ORDER-AB • Total: \$21\.50/)).toBeInTheDocument();
    expect(within(receipt).getByText('Payment: CASH')).toBeInTheDocument();
    expect(within(receipt).getByText('Blue Shirt')).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith(toastTitled('Sale completed!'));
    expect(screen.getByRole('button', { name: 'Cart (0)', hidden: true })).toBeInTheDocument();
  });

  it('labels the sale button with what is owed', async () => {
    const dialog = await openCheckout();

    expect(within(dialog).getByRole('button', { name: /complete sale/i })).toHaveTextContent('$22.00');
  });

  it('shows change due when the cash covers the sale', async () => {
    const dialog = await openCheckout();

    fireEvent.change(within(dialog).getByPlaceholderText('Amount received'), { target: { value: '50' } });

    expect(within(dialog).getByText('Change due').parentElement).toHaveTextContent('$28.00');
  });

  it('shows how much is still short when it does not', async () => {
    const dialog = await openCheckout();

    fireEvent.change(within(dialog).getByPlaceholderText('Amount received'), { target: { value: '10' } });

    expect(within(dialog).getByText('$12.00 short')).toBeInTheDocument();
  });

  it('offers quick-cash notes that fill in the amount received', async () => {
    const dialog = await openCheckout();

    fireEvent.click(within(dialog).getByRole('button', { name: '$50' }));

    expect(within(dialog).getByPlaceholderText('Amount received')).toHaveValue(50);
    expect(within(dialog).getByText('Change due').parentElement).toHaveTextContent('$28.00');
  });

  it('keeps the order and explains when the server refuses the sale', async () => {
    mutateAsync.mockRejectedValue(new Error('Only 1 left in stock'));
    const dialog = await openCheckout();

    completeSale(dialog);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', description: 'Only 1 left in stock', variant: 'destructive' })
      )
    );
    expect(screen.getByRole('dialog', { name: 'Complete Sale' })).toBeInTheDocument();
  });

  it('closes checkout and asks for sign-in when the shift has lapsed', async () => {
    mutateAsync.mockRejectedValue(apiError('SHIFT_REQUIRED'));
    const dialog = await openCheckout();

    completeSale(dialog);

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Sign-in required')));
    expect(screen.queryByRole('dialog', { name: 'Complete Sale' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cart (1)' })).toBeInTheDocument();
  });
});

describe('payment methods', () => {
  it('falls back to the first method the store accepts when cash is off', async () => {
    settingsQuery.data = {
      ...DEFAULT_SETTINGS,
      config: { paymentMethods: { cash: { enabled: false }, zelle: { enabled: true, destination: 'pay@corner.store' } } },
    };
    const dialog = await openCheckout();

    expect(within(dialog).queryByTestId('pay-cash')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('pay-zelle')).toHaveTextContent('pay@corner.store');
    expect(within(dialog).queryByPlaceholderText('Amount received')).not.toBeInTheDocument();
    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body.paymentMethod).toBe('Zelle');
    expect(submittedOrder().body).not.toHaveProperty('cashTendered');
  });

  it('records Zelle when the cashier switches to it', async () => {
    settingsQuery.data = { ...DEFAULT_SETTINGS, config: { paymentMethods: { zelle: { enabled: true } } } };
    const dialog = await openCheckout();

    fireEvent.click(within(dialog).getByTestId('pay-zelle'));
    fireEvent.click(within(dialog).getByTestId('pay-cash'));
    fireEvent.click(within(dialog).getByTestId('pay-zelle'));
    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body.paymentMethod).toBe('Zelle');
  });

  it('names the configured card provider', async () => {
    settingsQuery.data = {
      ...DEFAULT_SETTINGS,
      config: { paymentMethods: { card: { enabled: true, provider: 'stripe' } } },
    };
    const dialog = await openCheckout();

    expect(within(dialog).getByTestId('pay-card')).toHaveTextContent('Stripe Terminal');
  });
});

describe('discounts', () => {
  it('applies a quick percentage discount before tax', async () => {
    const dialog = await openCheckout();

    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));

    // $20 less 10% is $18; tax is charged on the $18.
    expect(row(dialog, 'Discount')).toHaveTextContent('-$2.00');
    expect(row(dialog, 'Tax')).toHaveTextContent('$1.80');
    expect(row(dialog, 'Total')).toHaveTextContent('$19.80');
    expect(within(dialog).getByRole('button', { name: /^Staff/ })).toBeDisabled();
  });

  it('never offers a discount kind the register cannot price', async () => {
    const dialog = await openCheckout();

    await within(dialog).findByRole('button', { name: /^Staff/ });

    expect(within(dialog).queryByRole('button', { name: /Buy One/ })).not.toBeInTheDocument();
  });

  it('says so when the store has no quick discounts', async () => {
    listForPos.mockResolvedValue([]);
    const dialog = await openCheckout();

    expect(await within(dialog).findByText('No quick discounts available')).toBeInTheDocument();
  });

  it('keeps selling when quick discounts fail to load', async () => {
    listForPos.mockRejectedValue(new Error('offline'));
    const dialog = await openCheckout();

    expect(await within(dialog).findByText('No quick discounts available')).toBeInTheDocument();
  });

  it('sends the applied discounts with the order', async () => {
    const dialog = await openCheckout();

    fireEvent.click(await within(dialog).findByRole('button', { name: /^Five Off/ }));
    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body).toMatchObject({
      discountTotal: 5,
      total: 16.5,
      appliedDiscounts: [expect.objectContaining({ source: 'quick_discount', id: 'd3', code: 'FIVE' })],
    });
  });

  it('applies a manual fixed-amount discount with the reason as its name', async () => {
    const dialog = await openCheckout();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fixed-amount discount' }));
    fireEvent.change(within(dialog).getByPlaceholderText('5.00'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByPlaceholderText('Reason (optional)'), { target: { value: 'Damaged' } });
    fireEvent.click(plainApply(dialog));

    expect(within(dialog).getByText('Damaged')).toBeInTheDocument();
    expect(row(dialog, 'Discount')).toHaveTextContent('-$3.00');
    expect(row(dialog, 'Total')).toHaveTextContent('$18.70');
  });

  it('applies a manual percentage discount under a default name', async () => {
    const dialog = await openCheckout();

    fireEvent.change(within(dialog).getByPlaceholderText('10'), { target: { value: '50' } });
    fireEvent.click(plainApply(dialog));

    expect(within(dialog).getByRole('button', { name: 'Remove the Manual Discount discount' })).toBeInTheDocument();
    expect(row(dialog, 'Total')).toHaveTextContent('$11.00');
  });

  it('rejects a percentage over 100', async () => {
    const dialog = await openCheckout();

    fireEvent.change(within(dialog).getByPlaceholderText('10'), { target: { value: '150' } });
    fireEvent.click(plainApply(dialog));

    expect(toastSpy).toHaveBeenCalledWith(toastTitled('Percentage cannot exceed 100%'));
    expect(within(dialog).queryByText('Discount')).not.toBeInTheDocument();
  });

  it('rejects a zero or negative amount', async () => {
    const dialog = await openCheckout();

    fireEvent.change(within(dialog).getByPlaceholderText('10'), { target: { value: '0' } });
    fireEvent.click(plainApply(dialog));

    expect(toastSpy).toHaveBeenCalledWith(toastTitled('Please enter a valid discount amount'));
  });

  it('disables Apply until an amount is entered', async () => {
    const dialog = await openCheckout();

    expect(plainApply(dialog)).toBeDisabled();
  });

  it('removes one discount, or all of them', async () => {
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Five Off/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the Staff discount' }));
    expect(row(dialog, 'Discount')).toHaveTextContent('-$5.00');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear All' }));
    expect(within(dialog).queryByText('Applied Discounts')).not.toBeInTheDocument();
    expect(row(dialog, 'Total')).toHaveTextContent('$22.00');
  });
});

describe('promo codes', () => {
  async function enterPromo(code: string) {
    const dialog = await openCheckout();
    fireEvent.mouseDown(within(dialog).getByRole('tab', { name: /promo code/i }));
    fireEvent.change(await within(dialog).findByPlaceholderText('SAVE20'), { target: { value: code } });
    return dialog;
  }

  function promo(over: Record<string, unknown> = {}) {
    return {
      promo: { id: 'pr1', code: 'SAVE5', name: 'Save Five', discountType: 'fixed', discountValue: 5, discountAmount: 5, ...over },
    };
  }

  it('validates the code against the cart and applies it', async () => {
    validatePromo.mockResolvedValue(promo());
    const dialog = await enterPromo('save5');

    fireEvent.click(plainApply(dialog));

    await waitFor(() => expect(row(dialog, 'Discount')).toHaveTextContent('-$5.00'));
    expect(validatePromo).toHaveBeenCalledWith({ code: 'SAVE5', cartTotal: 20, itemCount: 1 });
    expect(within(dialog).getByText('SAVE5')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('SAVE20')).toHaveValue('');
  });

  it('applies on Enter as well', async () => {
    validatePromo.mockResolvedValue(promo());
    const dialog = await enterPromo('SAVE5');

    fireEvent.keyDown(within(dialog).getByPlaceholderText('SAVE20'), { key: 'Enter' });

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Promo code applied!')));
  });

  it('will not apply the same code twice', async () => {
    validatePromo.mockResolvedValue(promo());
    const dialog = await enterPromo('SAVE5');
    fireEvent.click(plainApply(dialog));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Promo code applied!')));

    fireEvent.change(within(dialog).getByPlaceholderText('SAVE20'), { target: { value: 'SAVE5' } });
    fireEvent.click(plainApply(dialog));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Promo code already applied')));
    expect(row(dialog, 'Discount')).toHaveTextContent('-$5.00');
  });

  it('refuses an offer kind the register cannot take off the total', async () => {
    validatePromo.mockResolvedValue(promo({ discountType: 'free_shipping', discountAmount: 0 }));
    const dialog = await enterPromo('SHIP');

    fireEvent.click(plainApply(dialog));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Promo code not supported at the register',
          description: expect.stringContaining('free shipping'),
        })
      )
    );
    expect(within(dialog).queryByText('Discount')).not.toBeInTheDocument();
  });

  it('surfaces the server reason for a rejected code', async () => {
    validatePromo.mockRejectedValue(new Error('This code has expired'));
    const dialog = await enterPromo('OLD');

    fireEvent.click(plainApply(dialog));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Promo code not applied', description: 'This code has expired' })
      )
    );
  });
});

describe('store credit', () => {
  function credit(remainingAmount: number, status = 'active') {
    return { id: 'sc1', code: 'SC-1', originalAmount: 50, remainingAmount, status, createdAt: 0 };
  }

  async function applyCredit(dialog: HTMLElement, code = 'sc-1') {
    fireEvent.change(within(dialog).getByPlaceholderText('Credit code'), { target: { value: code } });
    fireEvent.click(within(dialog).getByTestId('apply-store-credit'));
  }

  it('takes a partial credit off what is due, leaving the sale total alone', async () => {
    getCredit.mockResolvedValue(credit(10));
    const dialog = await openCheckout();

    await applyCredit(dialog);

    expect(await within(dialog).findByText('$10.00 applied')).toBeInTheDocument();
    expect(getCredit).toHaveBeenCalledWith('SC-1');
    expect(within(dialog).getByText('Still due:').parentElement).toHaveTextContent('$12.00');
    expect(row(dialog, 'Total')).toHaveTextContent('$22.00');
    expect(within(dialog).getByRole('button', { name: /complete sale/i })).toHaveTextContent('$12.00');
  });

  it('splits the payment between credit and cash on the order', async () => {
    getCredit.mockResolvedValue(credit(10));
    const dialog = await openCheckout();
    await applyCredit(dialog);
    await within(dialog).findByText('$10.00 applied');

    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body.payments).toEqual([
      { method: 'store_credit', amount: 10, reference: 'SC-1' },
      { method: 'cash', amount: 12 },
    ]);
  });

  it('covers a sale in full and keeps the rest on the credit', async () => {
    getCredit.mockResolvedValue(credit(50));
    const dialog = await openCheckout();

    await applyCredit(dialog);

    expect(await within(dialog).findByText('The credit covers this sale in full.')).toBeInTheDocument();
    expect(within(dialog).getByText(/\$28\.00 stays on the credit/)).toBeInTheDocument();
    expect(within(dialog).queryByPlaceholderText('Amount received')).not.toBeInTheDocument();
  });

  it('applies on Enter and can be removed again', async () => {
    getCredit.mockResolvedValue(credit(10));
    const dialog = await openCheckout();
    fireEvent.change(within(dialog).getByPlaceholderText('Credit code'), { target: { value: 'SC-1' } });

    fireEvent.keyDown(within(dialog).getByPlaceholderText('Credit code'), { key: 'Enter' });
    await within(dialog).findByText('$10.00 applied');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the applied store credit' }));

    expect(within(dialog).getByPlaceholderText('Credit code')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /complete sale/i })).toHaveTextContent('$22.00');
  });

  it('refuses a credit that is used up or not active', async () => {
    getCredit.mockResolvedValue(credit(0, 'redeemed'));
    const dialog = await openCheckout();

    await applyCredit(dialog);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'That credit cannot be used', description: 'It is redeemed with $0.00 left.' })
      )
    );
    expect(within(dialog).queryByText(/applied/)).not.toBeInTheDocument();
  });

  it('explains an unknown code', async () => {
    getCredit.mockRejectedValue('not a real error object');
    const dialog = await openCheckout();

    await applyCredit(dialog);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Store credit not applied', description: 'not a real error object' })
      )
    );
  });

  it('does nothing with a blank code', async () => {
    const dialog = await openCheckout();

    await applyCredit(dialog, '  ');

    expect(getCredit).not.toHaveBeenCalled();
  });

  it('shows the shortfall against what is still due after the credit', async () => {
    getCredit.mockResolvedValue(credit(10));
    const dialog = await openCheckout();
    await applyCredit(dialog);
    await within(dialog).findByText('$10.00 applied');

    fireEvent.change(within(dialog).getByPlaceholderText('Amount received'), { target: { value: '5' } });

    expect(within(dialog).getByText('$7.00 short')).toBeInTheDocument();
  });
});

describe('supervisor override on a discount', () => {
  const overrideRefusal = () => apiError('OVERRIDE_REQUIRED', { action: 'discount_approval' });

  it('asks a supervisor, then resubmits the identical order with their grant', async () => {
    mutateAsync.mockRejectedValueOnce(overrideRefusal()).mockResolvedValueOnce(serverOrder());
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));

    completeSale(dialog);

    const prompt = await screen.findByTestId('override-prompt');
    expect(prompt).toHaveTextContent('Approve a 10% discount ("Staff")');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(submittedOrder(1).overrideToken).toBe('grant-tok');
    expect(submittedOrder(1).body).toEqual(submittedOrder(0).body);
    expect(await screen.findByRole('dialog', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('describes a fixed discount by its amount', async () => {
    mutateAsync.mockRejectedValue(overrideRefusal());
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Five Off/ }));

    completeSale(dialog);

    expect(await screen.findByTestId('override-prompt')).toHaveTextContent('Approve a $5.00 discount ("Five Off")');
  });

  it('describes several discounts by their total', async () => {
    mutateAsync.mockRejectedValue(overrideRefusal());
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Five Off/ }));

    completeSale(dialog);

    expect(await screen.findByTestId('override-prompt')).toHaveTextContent('Approve 2 discounts totalling $7.00');
  });

  it('leaves the order intact when the supervisor declines', async () => {
    mutateAsync.mockRejectedValue(overrideRefusal());
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));
    completeSale(dialog);

    fireEvent.click(within(await screen.findByTestId('override-prompt')).getByRole('button', { name: 'Deny' }));

    expect(screen.queryByTestId('override-prompt')).not.toBeInTheDocument();
    expect(row(dialog, 'Total')).toHaveTextContent('$19.80');
  });

  it('treats an override for some other action as an ordinary failure', async () => {
    mutateAsync.mockRejectedValue(apiError('OVERRIDE_REQUIRED', { action: 'refund' }));
    const dialog = await openCheckout();

    completeSale(dialog);

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Error')));
    expect(screen.queryByTestId('override-prompt')).not.toBeInTheDocument();
  });
});

describe('card payments on the terminal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    settingsQuery.data = {
      ...DEFAULT_SETTINGS,
      config: { paymentMethods: { card: { enabled: true, provider: 'square' } } },
    };
    charge.mockResolvedValue({ chargeId: 'ch_1', attemptId: 'att_1' });
    cancelCharge.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startCardSale() {
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByTestId('pay-card'));
    completeSale(dialog);
    await within(dialog).findByText('Waiting for card...');
    return dialog;
  }

  const poll = (ms = 2_000) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('sends the cart to be priced, not an amount, and waits for the card', async () => {
    const dialog = await startCardSale();

    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ productId: 'p1', variantId: 'v1', quantity: 1, notes: undefined }],
        currency: 'USD',
      })
    );
    expect(charge.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(within(dialog).getByRole('button', { name: /complete sale/i })).toBeDisabled();
  });

  it('records the approved charge on the order and prints its auth code', async () => {
    chargeStatus.mockResolvedValue({ status: 'approved', authCode: 'AUTH42', receipt: { aid: 'A0001' } });
    await startCardSale();

    await poll();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(submittedOrder().body).toMatchObject({
      paymentMethod: 'Card',
      cardTransactionId: 'ch_1',
      attemptId: 'att_1',
      cardAuthCode: 'AUTH42',
      cardReceipt: { aid: 'A0001' },
    });
    const receipt = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(receipt).getByText('Auth: AUTH42')).toBeInTheDocument();
    expect(within(receipt).getByText('Payment: CARD')).toBeInTheDocument();
  });

  it('keeps polling through a network hiccup', async () => {
    chargeStatus.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ status: 'approved', authCode: 'OK' });
    await startCardSale();

    await poll();
    expect(mutateAsync).not.toHaveBeenCalled();
    await poll();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });

  it('shows a decline and lets the cashier try again or switch method', async () => {
    chargeStatus.mockResolvedValue({ status: 'declined', errorMessage: 'Insufficient funds' });
    const dialog = await startCardSale();

    await poll();

    expect(await within(dialog).findByText('Card Declined')).toBeInTheDocument();
    expect(within(dialog).getByText('Insufficient funds')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try Again' }));
    await within(dialog).findByText('Waiting for card...');
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it('returns to method selection after a decline', async () => {
    chargeStatus.mockResolvedValue({ status: 'declined' });
    const dialog = await startCardSale();
    await poll();
    expect(await within(dialog).findByText('Card declined')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch Method' }));

    expect(within(dialog).queryByText('Card Declined')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /complete sale/i })).toBeEnabled();
  });

  it.each([
    [{ status: 'error' }, 'Terminal error'],
    [{ status: 'error', errorMessage: 'Reader offline' }, 'Reader offline'],
    [{ status: 'cancelled' }, 'Terminal operation cancelled'],
  ])('reports a terminal outcome of %o as "%s" with a retry', async (status, message) => {
    chargeStatus.mockResolvedValue(status);
    const dialog = await startCardSale();

    await poll();

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch Method' }));
    expect(within(dialog).queryByText(message)).not.toBeInTheDocument();
  });

  it('cancels a charge the terminal never answers', async () => {
    chargeStatus.mockResolvedValue({ status: 'pending' });
    const dialog = await startCardSale();

    await poll(90_000);

    expect(await within(dialog).findByText('No response from terminal — charge cancelled')).toBeInTheDocument();
    expect(cancelCharge).toHaveBeenCalledWith('ch_1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it('lets the cashier cancel a charge that is waiting', async () => {
    chargeStatus.mockResolvedValue({ status: 'pending' });
    const dialog = await startCardSale();

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[0]);

    await waitFor(() => expect(within(dialog).queryByText('Waiting for card...')).not.toBeInTheDocument());
    expect(cancelCharge).toHaveBeenCalledWith('ch_1');
  });

  it("shows the server's reason when the charge cannot start", async () => {
    charge.mockRejectedValue(new Error('That discount has expired'));
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByTestId('pay-card'));

    completeSale(dialog);

    expect(await within(dialog).findByText('That discount has expired')).toBeInTheDocument();
  });

  it('skips the terminal when store credit covers the whole sale', async () => {
    getCredit.mockResolvedValue({ id: 'sc', code: 'SC-9', originalAmount: 50, remainingAmount: 50, status: 'active', createdAt: 0 });
    const dialog = await openCheckout();
    fireEvent.change(within(dialog).getByPlaceholderText('Credit code'), { target: { value: 'SC-9' } });
    fireEvent.click(within(dialog).getByTestId('apply-store-credit'));
    await within(dialog).findByText('The credit covers this sale in full.');
    fireEvent.click(within(dialog).getByTestId('pay-card'));

    completeSale(dialog);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(charge).not.toHaveBeenCalled();
    expect(submittedOrder().body.payments).toEqual([{ method: 'store_credit', amount: 22, reference: 'SC-9' }]);
  });

  it('reports a card order that could not be saved', async () => {
    chargeStatus.mockResolvedValue({ status: 'approved', authCode: 'A' });
    mutateAsync.mockRejectedValue(new Error('Database unavailable'));
    await startCardSale();

    await poll();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Order save failed', description: 'Database unavailable' })
      )
    );
  });

  it('asks for sign-in when the shift lapsed between charge and save', async () => {
    chargeStatus.mockResolvedValue({ status: 'approved', authCode: 'A' });
    mutateAsync.mockRejectedValue(apiError('SHIFT_REQUIRED'));
    await startCardSale();

    await poll();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Sign-in required')));
  });

  it('re-saves an approved card sale under a supervisor grant without charging again', async () => {
    chargeStatus.mockResolvedValue({ status: 'approved', authCode: 'A' });
    mutateAsync
      .mockRejectedValueOnce(apiError('OVERRIDE_REQUIRED', { action: 'discount_approval' }))
      .mockResolvedValueOnce(serverOrder());
    const dialog = await openCheckout();
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Staff/ }));
    fireEvent.click(within(dialog).getByTestId('pay-card'));
    completeSale(dialog);
    await within(dialog).findByText('Waiting for card...');
    await poll();

    fireEvent.click(within(await screen.findByTestId('override-prompt')).getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(submittedOrder(1).overrideToken).toBe('grant-tok');
    expect(submittedOrder(1).body.cardTransactionId).toBe('ch_1');
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('tells the customer the amount the card will actually be charged', async () => {
    const dialog = await startCardSale();

    expect(within(dialog).getByText(/Present card on the terminal/)).toHaveTextContent('$22.00');
  });
});

describe('the header tools', () => {
  it('opens the cash drawer', async () => {
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: /drawer/i }));

    expect(await screen.findByRole('dialog', { name: /cash drawer/i })).toBeInTheDocument();
  });

  it('opens returns', async () => {
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: /returns/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
