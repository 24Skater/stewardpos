import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';

/**
 * The admin pages are *driven*, not merely rendered.
 *
 * `adminPages.render.test.tsx` proves these fifteen components mount. That is
 * worth having and it is not enough: frontend function coverage sits at 16.52%
 * because nothing clicks a save, submits a form, or opens a dialog. Two defects
 * of exactly that shape shipped in one afternoon — a health check pointed at an
 * address nothing listened on, and the register's Admin button routed to the
 * login page. Both typechecked. Both rendered. Both were wrong.
 *
 * A button that exists and a button that works are different claims, and only
 * the first was ever being tested.
 */

/** Calls the pages make, so a save can be checked for having reached the API. */
const calls: string[] = [];

const LISTISH = /^(list|search|audit|all|history|lowStock|by[A-Z]|forPos|unmanaged|types)/;

const EMPTY_SHAPES: Record<string, unknown> = {
  'returnsApi.stats': {
    totalReturns: 0,
    completedReturns: 0,
    pendingReturns: 0,
    rejectedReturns: 0,
    totalRefunded: 0,
    totalStoreCredits: 0,
    uniqueCustomers: 0,
  },
  'discountsApi.stats': { totalDiscounts: 0, totalDiscountCount: 0, totalDiscountAmount: 0 },
  'apiKeysApi.reference': {
    version: '1.0.0',
    baseUrl: '/api',
    authentication: { type: 'API key', header: 'X-API-Key', format: '<key>', example: 'X-API-Key: spk_…' },
    scopes: {},
    rateLimiting: {},
    errors: {},
    endpoints: [],
    examples: {},
  },
  // Every `getList` endpoint resolves to `{ data, meta }`, not a bare array —
  // `apiClient.getList` unwraps the envelope but keeps the pagination. Stubbed
  // as `[]`, destructuring `{ data }` yields undefined and the page crashes on
  // `.filter`. Model what the server sends.
  'adminApi.audit': { data: [], meta: { total: 0, limit: 50, offset: 0 } },
  'receiptsApi.list': { data: [], meta: { total: 0, limit: 50, offset: 0, hasMore: false } },
  'productsApi.listPage': { data: [], meta: { total: 0, limit: 50, offset: 0 } },
  'categoriesApi.listWithUnmanaged': { data: [], meta: { total: 0, unmanaged: [] } },
  // The real shape of `POST /api/receipts/:id/start-return`. Stubbed as `{}`,
  // `returnableItems` came back undefined and AdminReceipts crashed on
  // `.filter` — which is a fair thing for the harness to have exposed, but the
  // stub should still model what the server sends.
  'receiptsApi.startReturn': {
    order: { id: 'o1', createdAt: 0, total: 0 },
    returnableItems: [],
    hasReturnableItems: false,
    existingReturns: 0,
  },
  'reportsApi.salesSummary': {
    from: 0, to: 0, orderCount: 0, gross: 0, discounts: 0, tax: 0, net: 0,
    refunds: 0, netAfterRefunds: 0, avgTicket: 0, pendingRefunds: 0,
  },
  'reportsApi.salesByDay': [],
  'reportsApi.topProducts': [],
  'reportsApi.paymentMix': [],
  'reportsApi.returnsSummary': {
    from: 0, to: 0, returnCount: 0, refunded: 0, pendingCount: 0, pendingAmount: 0, byReason: [],
  },
  'reportsApi.salesByRegister': {
    registers: [],
    capabilitySplit: {
      drawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
      nonDrawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
    },
  },
  'reportsApi.salesByCashier': [],
  'reportsApi.salesByLocation': [],
  'reportsApi.drawerVarianceByRegister': [],
  'reportsApi.noSaleCounts': [],
  // Settings has to come back populated: the pages spread it into form state and
  // read fields off it directly.
  'adminApi.settings.get': {
    taxRateDefault: 0.08,
    storeName: 'Corner Store',
    storeEmail: 'hi@shop.test',
    storePhone: '555',
    timezone: 'UTC',
    config: {
      authMethods: { local: true, google: false, oidc: false },
      paymentMethods: { cash: { enabled: true }, zelle: { enabled: false }, card: { enabled: false } },
    },
  },
};

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = { ...actual };

  const stubGroup = (group: Record<string, unknown>, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(group)) {
      const key = `${path}.${name}`;
      if (typeof value === 'function') {
        const empty = key in EMPTY_SHAPES ? EMPTY_SHAPES[key] : LISTISH.test(name) ? [] : {};
        out[name] = vi.fn(async () => {
          calls.push(key);
          return empty;
        });
      } else if (value && typeof value === 'object') {
        out[name] = stubGroup(value as Record<string, unknown>, key);
      } else {
        out[name] = value;
      }
    }
    return out;
  };

  for (const [key, value] of Object.entries(actual)) {
    if (key.endsWith('Api') && value && typeof value === 'object') {
      stubbed[key] = stubGroup(value as Record<string, unknown>, key);
    }
  }
  return stubbed;
});

/**
 * A signed-in administrator.
 *
 * Without this the pages render read-only: every write control is behind
 * `hasPermission(session, …, 'write')`, and an unmocked `useSession` resolves to
 * `null`. The first version of this file had no session and concluded there was
 * no "Add Customer" button — there is, correctly hidden from someone who may not
 * use it. Driving the write paths means being someone allowed to.
 */
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

// Some pages take the session from the hook and others call `getCurrentSession`
// directly in an effect, so both have to be answered. `hasPermission` and
// `hasRole` are left real — the point is to exercise the actual gating, not to
// bypass it.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentSession: vi.fn(async () => ADMIN_SESSION) };
});

/**
 * Toasts, captured.
 *
 * The Toaster is not mounted here, so a toast leaves no mark on the DOM — and
 * the message these pages show is the whole of what the operator learns about
 * whether an export worked.
 */
const toasts: { title?: string; description?: string }[] = [];

vi.mock('@/hooks/use-toast', () => {
  const toast = (message: { title?: string; description?: string }) => {
    toasts.push(message);
  };
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

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
const pageErrors: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  toasts.length = 0;
  pageErrors.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    pageErrors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  consoleError.mockRestore();
});

const TIMEOUT = 20_000;

describe('AdminSettings', () => {
  it('reaches the API when Save is clicked', async () => {
    // The whole point. A save button that renders and posts nothing looks
    // identical on screen to one that works, right up until a shop discovers
    // its tax rate never changed.
    const { default: Page } = await import('../admin/AdminSettings');
    renderPage(Page);

    const save = await screen.findByRole('button', { name: /save settings/i });
    fireEvent.click(save);

    await waitFor(() => expect(calls).toContain('adminApi.settings.update'));
  }, TIMEOUT);

  it('sends the edited store name, not the loaded one', async () => {
    // Posting *something* is not the same as posting what was typed. This is the
    // failure where a form appears to save and silently discards the edit.
    const { adminApi } = await import('@/lib/api');
    const { default: Page } = await import('../admin/AdminSettings');
    renderPage(Page);

    const name = await screen.findByLabelText(/store name/i);
    fireEvent.change(name, { target: { value: 'Hillside Books' } });
    fireEvent.click(await screen.findByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(adminApi.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({ storeName: 'Hillside Books' })
      );
    });
  }, TIMEOUT);
});

/**
 * Pages whose "add" control opens a dialog before anything can be created.
 *
 * Opening it is the step that runs the handler, mounts the form and wires its
 * state — and is where a component that renders happily can still throw.
 */
const CREATE_DIALOGS: Array<[string, () => Promise<{ default: ComponentType }>, RegExp, RegExp]> = [
  ['AdminCustomers', () => import('../admin/AdminCustomers'), /add customer/i, /name/i],
  ['AdminServices', () => import('../admin/AdminServices'), /add service/i, /name/i],
  ['AdminRoles', () => import('../admin/AdminRoles'), /add role/i, /name/i],
];

describe.each(CREATE_DIALOGS)('%s', (_name, load, trigger, field) => {
  it('opens its create dialog without throwing', async () => {
    const { default: Page } = await import_(load);
    renderPage(Page);

    const button = await screen.findByRole('button', { name: trigger });
    expect(() => fireEvent.click(button)).not.toThrow();

    // The dialog's own form has to mount, not merely the button that opens it.
    await waitFor(() => expect(screen.getAllByLabelText(field).length).toBeGreaterThan(0));
  }, TIMEOUT);

  it('logs no React error while opening it', async () => {
    const { default: Page } = await import_(load);
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: trigger }));
    await waitFor(() => expect(screen.getAllByLabelText(field).length).toBeGreaterThan(0));

    const react = pageErrors.filter(
      (line) => line.includes('Warning:') || line.includes('Error:') || line.includes('React')
    );
    expect(react).toEqual([]);
  }, TIMEOUT);
});

/** `describe.each` cannot await the loader inline; this keeps the types honest. */
async function import_(load: () => Promise<{ default: ComponentType }>) {
  return load();
}

describe('AdminReports', () => {
  it('re-queries when the period changes', async () => {
    // The range picker is the only control on the page. If it does not refetch,
    // every preset shows the same figures under a different heading.
    const { default: Page } = await import('../admin/AdminReports');
    renderPage(Page);

    await waitFor(() => expect(calls).toContain('reportsApi.salesSummary'));
    const before = calls.filter((c) => c === 'reportsApi.salesSummary').length;

    fireEvent.click(await screen.findByRole('button', { name: /last 30 days/i }));

    await waitFor(() => {
      expect(calls.filter((c) => c === 'reportsApi.salesSummary').length).toBeGreaterThan(before);
    });
  }, TIMEOUT);
});

describe('AdminAudit', () => {
  it('re-queries when a filter changes', async () => {
    // The filters were client-side until Phase 6 — they looked like they
    // searched the log and searched one page of it. This asserts they now ask
    // the server.
    const { default: Page } = await import('../admin/AdminAudit');
    renderPage(Page);

    await waitFor(() => expect(calls).toContain('adminApi.audit'));
    const before = calls.filter((c) => c === 'adminApi.audit').length;

    fireEvent.change(await screen.findByLabelText(/^from$/i), {
      target: { value: '2026-08-01' },
    });

    await waitFor(() => {
      expect(calls.filter((c) => c === 'adminApi.audit').length).toBeGreaterThan(before);
    });
  }, TIMEOUT);
});

describe('AdminInventory', () => {
  it('opens the product dialog and reaches the API on create', async () => {
    // Inventory is where a shop spends most of its admin time, and a create
    // that renders but posts nothing is indistinguishable from one that works
    // until the product is not there.
    const { default: Page } = await import('../admin/AdminInventory');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));

    const name = await screen.findByLabelText(/product name|^name$/i);
    fireEvent.change(name, { target: { value: 'Loose Leaf Tea' } });

    fireEvent.click(await screen.findByRole('button', { name: /create product|save/i }));

    await waitFor(() => expect(calls.some((c) => c.startsWith('productsApi.'))).toBe(true));
  }, TIMEOUT);
});

describe('AdminExports', () => {
  it('fetches report data when an export is requested', async () => {
    // The Sales Summary export reads the reporting API at export time so the
    // file matches the screen. If the click posts nothing, the operator gets
    // silence and no file.
    const { default: Page } = await import('../admin/AdminExports');
    renderPage(Page);

    // Named specifically. Fifteen buttons on this page were all called "CSV",
    // which made them indistinguishable to a test and to a screen reader alike —
    // each now says which report it exports.
    fireEvent.click(await screen.findByRole('button', { name: /export sales summary as csv/i }));

    await waitFor(() => expect(calls.some((c) => c.startsWith('reportsApi.'))).toBe(true));
  }, TIMEOUT);

  /**
   * The exact defect reported from the shop floor: on a store with no rows for
   * a report, the Excel and CSV buttons downloaded nothing and then said
   * "Export completed successfully". A silent no-op that claims to have worked
   * is worse than a visible failure — the operator stops looking for the file.
   *
   * Sales by Item is the empty one here: this harness resolves every list
   * endpoint to `[]`, so there are no orders to aggregate into rows.
   */
  it.each([
    [/export sales item as csv/i],
    [/export sales item as excel/i],
  ])('says nothing was exported rather than claiming success (%s)', async (button) => {
    const { default: Page } = await import('../admin/AdminExports');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.at(-1)?.title).toBe('Nothing to export');
    expect(toasts.map((message) => message.title)).not.toContain('Export completed successfully');
  }, TIMEOUT);

  it('still reports success for a report that does have rows', async () => {
    // The guard must not swallow the ordinary case. Sales Summary always
    // carries a totals row — zeroes are still figures — so it writes a file
    // even against this empty harness.
    // jsdom has no object-URL support and will not navigate an anchor, so the
    // two steps that actually hand the file to the browser are stubbed. What is
    // under test is which toast follows, not the download itself.
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { default: Page } = await import('../admin/AdminExports');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: /export sales summary as csv/i }));

    await waitFor(() => expect(toasts.at(-1)?.title).toBe('Export completed successfully'));
  }, TIMEOUT);
});

describe('every admin page', () => {
  /**
   * Clicking the obviously-safe controls on each page.
   *
   * Not an assertion about behaviour — an assertion that the handlers run at
   * all. A component can render perfectly and still throw the moment a handler
   * touches state that was never initialised, which is the shape of every
   * browser-only defect this project has shipped.
   */
  const PAGES: Array<[string, () => Promise<{ default: ComponentType }>]> = [
    ['Dashboard', () => import('../admin/Dashboard')],
    ['AdminInventory', () => import('../admin/AdminInventory')],
    ['AdminReports', () => import('../admin/AdminReports')],
    ['AdminExports', () => import('../admin/AdminExports')],
    ['AdminCustomers', () => import('../admin/AdminCustomers')],
    ['AdminServices', () => import('../admin/AdminServices')],
    ['AdminSettings', () => import('../admin/AdminSettings')],
    ['AdminRoles', () => import('../admin/AdminRoles')],
    ['AdminAudit', () => import('../admin/AdminAudit')],
    ['AdminQuotes', () => import('../admin/AdminQuotes')],
    ['AdminApiKeys', () => import('../admin/AdminApiKeys')],
    ['AdminReturns', () => import('../admin/AdminReturns')],
    ['AdminReceipts', () => import('../admin/AdminReceipts')],
    ['AdminDiscounts', () => import('../admin/AdminDiscounts')],
  ];

  /** Anything that deletes, resets, or spends money is left alone. */
  const DESTRUCTIVE = /delete|remove|reset|revoke|archive|refund|reject|void|clear/i;

  it.each(PAGES)('%s survives its own controls being clicked', async (_name, load) => {
    const { default: Page } = await load();
    renderPage(Page);

    await waitFor(() => expect(document.body.textContent?.trim()).not.toBe(''));

    const buttons = screen
      .queryAllByRole('button')
      .filter((b) => !b.hasAttribute('disabled') && !DESTRUCTIVE.test(b.textContent ?? ''));

    for (const button of buttons.slice(0, 12)) {
      expect(() => fireEvent.click(button)).not.toThrow();
    }

    const crashes = pageErrors.filter(
      (line) => line.includes('Uncaught') || line.includes('is not a function') || line.includes('undefined')
    );
    expect(crashes).toEqual([]);
  }, TIMEOUT);
});
