import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';

/**
 * Every admin page mounts, paints, and survives an empty backend.
 *
 * `src/pages/admin` is twenty components and roughly ten thousand lines at 0%
 * coverage. Unit-testing their behaviour properly is a large piece of work;
 * proving they *render* is not, and it is the check that would have caught both
 * browser-only defects this project has shipped — a temporal-dead-zone crash on
 * first paint, and a CORS failure that surfaced as an error boundary. Both
 * passed typecheck, the production build, and every unit test of the day.
 *
 * The empty-backend case is deliberate rather than incidental. A fresh install
 * has no orders, no customers and no returns, and a page that does
 * `data[0].total` on mount works perfectly for the developer with a seeded
 * database and breaks for every new shop on its first login.
 */

/** Method names whose callers expect a list back. */
const LISTISH = /^(list|search|audit|all|history|lowStock|by[A-Z]|forPos|unmanaged|types)/;

/**
 * Endpoints whose empty response is a populated object, not an empty one.
 *
 * These are modelled from what the backend actually returns with nothing in the
 * database — `getReturnStats` COALESCEs every aggregate to 0 and returns all
 * seven keys, and the API-docs endpoint is static content. Stubbing them as
 * `{}` invents a response the server never sends, and the resulting crash says
 * nothing about the page: both call sites already guard on the value being
 * present (`{stats && …}`, `{apiDocs && …}`), which is the check that matters.
 */
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
  'discountsApi.stats': {
    totalDiscounts: 0,
    totalDiscountCount: 0,
    totalDiscountAmount: 0,
  },
  // The API reference is static content the server always returns in full; the
  // page reads `authentication.header` from it rather than restating the header
  // itself, so an `{}` stub would model a response the server never sends.
  'apiKeysApi.reference': {
    version: '1.0.0',
    baseUrl: '/api',
    authentication: {
      type: 'API key',
      header: 'X-API-Key',
      format: '<api_key>',
      example: 'X-API-Key: spk_abc12345_...',
    },
    scopes: {},
    rateLimiting: {},
    errors: {},
    endpoints: [],
    examples: {},
  },
  // `getList` endpoints resolve to `{ data, meta }`, not to a bare array. The
  // generic list stub would hand the page an `undefined` payload — a shape the
  // server never sends, so the resulting crash would say nothing about the page.
  'adminApi.audit': { data: [], meta: { total: 0, limit: 50, offset: 0 } },
  // The reporting endpoints COALESCE every aggregate, so an empty range comes
  // back as a complete object of zeroes rather than as `{}`. Stubbing them bare
  // would crash the report cards on `undefined.toLocaleString` and prove only
  // that the stub was wrong.
  'reportsApi.salesSummary': {
    from: 0,
    to: 0,
    orderCount: 0,
    gross: 0,
    discounts: 0,
    tax: 0,
    net: 0,
    refunds: 0,
    netAfterRefunds: 0,
    avgTicket: 0,
    pendingRefunds: 0,
  },
  'reportsApi.salesByDay': [],
  'reportsApi.topProducts': [],
  'reportsApi.paymentMix': [],
  'reportsApi.returnsSummary': {
    from: 0,
    to: 0,
    returnCount: 0,
    refunded: 0,
    pendingCount: 0,
    pendingAmount: 0,
    byReason: [],
  },
};

/**
 * A stub API surface derived from the real one.
 *
 * Every function on every `*Api` export is replaced with one that resolves to an
 * empty collection, so the pages run their real mount effects and their real
 * rendering against a backend that has nothing in it.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = { ...actual };

  const stubGroup = (group: Record<string, unknown>, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(group)) {
      const key = `${path}.${name}`;
      if (typeof value === 'function') {
        const empty = key in EMPTY_SHAPES ? EMPTY_SHAPES[key] : LISTISH.test(name) ? [] : {};
        out[name] = vi.fn(async () => empty);
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

// The auth gate and the chrome are not what these tests are about, and both
// navigate on mount, which would replace the page under test with a redirect.
vi.mock('@/components/ProtectedRoute', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

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
  ['AdminComponents', () => import('../admin/AdminComponents')],
  ['AdminQuotes', () => import('../admin/AdminQuotes')],
  ['AdminApiKeys', () => import('../admin/AdminApiKeys')],
  ['AdminReturns', () => import('../admin/AdminReturns')],
  ['AdminReceipts', () => import('../admin/AdminReceipts')],
  ['AdminDiscounts', () => import('../admin/AdminDiscounts')],
];

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

afterEach(() => {
  consoleError.mockRestore();
});

/**
 * Mounting a 900-line page under jsdom is not fast, and several of these are
 * well over that. The default 5s budget passes comfortably on an idle machine
 * and flakes on a busy one — which is what CI is. A flaky test in the merge
 * gate teaches people to re-run it, so the budget is set where the work
 * actually is.
 */
const RENDER_TIMEOUT = 20_000;

describe.each(PAGES)('%s', (name, load) => {
  it('mounts against an empty backend without throwing', async () => {
    const { default: Page } = await load();

    expect(() => renderPage(Page)).not.toThrow();

    // Let the mount effects settle; a crash in an async loader lands here
    // rather than during the synchronous render.
    await waitFor(() => expect(document.body.textContent).not.toBe(''));
  }, RENDER_TIMEOUT);

  it('renders something rather than an empty document', async () => {
    const { default: Page } = await load();

    renderPage(Page);

    await waitFor(() => {
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }, RENDER_TIMEOUT);

  it('logs no React error while mounting', async () => {
    const { default: Page } = await load();

    renderPage(Page);
    await waitFor(() => expect(document.body.textContent).not.toBe(''));

    const reactErrors = consoleError.mock.calls.filter((call) => {
      const first = String(call[0] ?? '');
      // Recharts complains about a zero-size container under jsdom, which says
      // nothing about the page and would fail every chart page forever.
      return !first.includes('width(0) and height(0)');
    });

    expect(reactErrors.map((c) => String(c[0])).join('\n')).toBe('');
  }, RENDER_TIMEOUT);
});
