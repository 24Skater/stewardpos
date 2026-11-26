import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuthSession } from '@/lib/auth';

/**
 * App routing: which route renders which page, and who each guard lets through.
 *
 * Every page is stubbed to its own name so the assertion is about the route
 * table and the guards in front of it, not about any page's contents.
 */

let session: AuthSession | null = null;
let sessionPending = false;
vi.mock('@/hooks/queries/useSession', () => ({
  useSession: () => ({ data: session, isPending: sessionPending }),
  useInvalidateSession: () => vi.fn(),
}));

const setupStatus = vi.fn();
vi.mock('@/lib/api', () => ({ setupApi: { status: () => setupStatus() } }));

let deviceToken: string | null = null;
vi.mock('@/lib/register-device', () => ({ getDeviceToken: () => deviceToken }));
let tillToken: string | null = null;
vi.mock('@/lib/auth-store', () => ({ authStore: { getToken: () => tillToken } }));
vi.mock('@/components/register/LockScreen', () => ({ default: () => <p>Lock screen</p> }));
vi.mock('@/components/StoreBranding', () => ({ default: () => null }));

vi.mock('@/pages/POS', () => ({ default: () => <p>page:POS</p> }));
vi.mock('@/pages/Login', () => ({ default: () => <p>page:Login</p> }));
vi.mock('@/pages/Setup', () => ({ default: () => <p>page:Setup</p> }));
vi.mock('@/pages/PairRegister', () => ({ default: () => <p>page:PairRegister</p> }));
vi.mock('@/pages/Inventory', () => ({ default: () => <p>page:Inventory</p> }));
vi.mock('@/pages/Settings', () => ({ default: () => <p>page:Settings</p> }));
vi.mock('@/pages/ServicesPos', () => ({ default: () => <p>page:ServicesPos</p> }));
vi.mock('@/pages/NotFound', () => ({ default: () => <p>page:NotFound</p> }));
vi.mock('@/pages/admin/Dashboard', () => ({ default: () => <p>page:Dashboard</p> }));
vi.mock('@/pages/admin/AdminInventory', () => ({ default: () => <p>page:AdminInventory</p> }));
vi.mock('@/pages/admin/AdminReports', () => ({ default: () => <p>page:AdminReports</p> }));
vi.mock('@/pages/admin/AdminExports', () => ({ default: () => <p>page:AdminExports</p> }));
vi.mock('@/pages/admin/AdminCustomers', () => ({ default: () => <p>page:AdminCustomers</p> }));
vi.mock('@/pages/admin/AdminServices', () => ({ default: () => <p>page:AdminServices</p> }));
vi.mock('@/pages/admin/AdminSettings', () => ({ default: () => <p>page:AdminSettings</p> }));
vi.mock('@/pages/admin/AdminRoles', () => ({ default: () => <p>page:AdminRoles</p> }));
vi.mock('@/pages/admin/AdminAudit', () => ({ default: () => <p>page:AdminAudit</p> }));
vi.mock('@/pages/admin/AdminComponents', () => ({ default: () => <p>page:AdminComponents</p> }));
vi.mock('@/pages/admin/AdminQuotes', () => ({ default: () => <p>page:AdminQuotes</p> }));
vi.mock('@/pages/admin/AdminApiKeys', () => ({ default: () => <p>page:AdminApiKeys</p> }));
vi.mock('@/pages/admin/AdminReturns', () => ({ default: () => <p>page:AdminReturns</p> }));
vi.mock('@/pages/admin/AdminReceipts', () => ({ default: () => <p>page:AdminReceipts</p> }));
vi.mock('@/pages/admin/AdminDiscounts', () => ({ default: () => <p>page:AdminDiscounts</p> }));
vi.mock('@/pages/admin/AdminRegisters', () => ({ default: () => <p>page:AdminRegisters</p> }));
vi.mock('@/pages/admin/AdminOverrides', () => ({ default: () => <p>page:AdminOverrides</p> }));
vi.mock('@/pages/admin/AdminShifts', () => ({ default: () => <p>page:AdminShifts</p> }));
vi.mock('@/pages/admin/AdminReconciliation', () => ({ default: () => <p>page:AdminReconciliation</p> }));

const { default: App } = await import('@/App');

function makeSession(systemRole: string, permissions: Record<string, unknown> = {}): AuthSession {
  return {
    user: {
      id: 'u1',
      email: 'u@shop.test',
      name: 'U',
      roleIds: ['r1'],
      roles: [{ id: 'r1', name: 'Role', systemRole, permissions: permissions as never }],
    },
    permissions: permissions as never,
  };
}

function visit(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  session = null;
  sessionPending = false;
  deviceToken = null;
  tillToken = null;
  setupStatus.mockReset();
  setupStatus.mockResolvedValue({ needsSetup: false });
});

describe('App routing', () => {
  it.each([
    ['/admin', 'Dashboard'],
    ['/admin/inventory', 'AdminInventory'],
    ['/admin/reports', 'AdminReports'],
    ['/admin/exports', 'AdminExports'],
    ['/admin/customers', 'AdminCustomers'],
    ['/admin/services', 'AdminServices'],
    ['/admin/quotes', 'AdminQuotes'],
    ['/admin/settings', 'AdminSettings'],
    ['/admin/roles', 'AdminRoles'],
    ['/admin/audit', 'AdminAudit'],
    ['/admin/components', 'AdminComponents'],
    ['/admin/api-keys', 'AdminApiKeys'],
    ['/admin/returns', 'AdminReturns'],
    ['/admin/receipts', 'AdminReceipts'],
    ['/admin/discounts', 'AdminDiscounts'],
    ['/admin/registers', 'AdminRegisters'],
    ['/admin/overrides', 'AdminOverrides'],
    ['/admin/shifts', 'AdminShifts'],
    ['/admin/reconciliation', 'AdminReconciliation'],
    ['/inventory', 'Inventory'],
    ['/settings', 'Settings'],
    ['/services', 'ServicesPos'],
  ])('an administrator reaches %s', async (path, page) => {
    session = makeSession('admin');

    visit(path);

    expect(await screen.findByText(`page:${page}`)).toBeInTheDocument();
  });

  it.each([
    ['/setup', 'Setup'],
    ['/login', 'Login'],
    ['/pair', 'PairRegister'],
    ['/no-such-page', 'NotFound'],
  ])('%s is reachable without signing in', async (path, page) => {
    visit(path);

    expect(await screen.findByText(`page:${page}`)).toBeInTheDocument();
  });

  it('sends a signed-out visitor to login from an admin route', async () => {
    visit('/admin/settings');

    expect(await screen.findByText('page:Login')).toBeInTheDocument();
    expect(window.location.search).toBe(`?next=${encodeURIComponent('/admin/settings')}`);
  });

  it('sends an unconfigured install to the setup wizard', async () => {
    setupStatus.mockResolvedValue({ needsSetup: true });
    session = makeSession('admin');

    visit('/admin');

    expect(await screen.findByText('page:Setup')).toBeInTheDocument();
  });

  it('refuses API keys to a non-admin even with settings:write', async () => {
    session = makeSession('standard', { settings: { read: true, write: true } });

    visit('/admin/api-keys');

    expect(await screen.findByText(/limited to administrators/i)).toBeInTheDocument();
    expect(screen.queryByText('page:AdminApiKeys')).not.toBeInTheDocument();
  });

  it('lets settings:write reach components, but settings:read alone cannot', async () => {
    session = makeSession('standard', { settings: { read: true, write: true } });
    const { unmount } = visit('/admin/components');
    expect(await screen.findByText('page:AdminComponents')).toBeInTheDocument();
    unmount();

    session = makeSession('standard', { settings: { read: true } });
    visit('/admin/components');
    expect(await screen.findByText(/cannot write settings/i)).toBeInTheDocument();
  });

  it('gates quotes on services:read and roles on users:read', async () => {
    session = makeSession('standard', { services: { read: true } });
    const { unmount } = visit('/admin/quotes');
    expect(await screen.findByText('page:AdminQuotes')).toBeInTheDocument();
    unmount();

    visit('/admin/roles');
    expect(await screen.findByText(/cannot read users/i)).toBeInTheDocument();
  });

  it.each(['/', '/pos'])('%s sends an unpaired terminal to pairing', async (path) => {
    visit(path);

    expect(await screen.findByText('page:PairRegister')).toBeInTheDocument();
  });

  it('shows the lock screen on a paired terminal with no till session', async () => {
    deviceToken = 'srt_device';

    visit('/pos');

    expect(await screen.findByText('Lock screen')).toBeInTheDocument();
  });

  it('opens the register on a paired, signed-on terminal', async () => {
    deviceToken = 'srt_device';
    tillToken = 'till-session';

    visit('/');

    expect(await screen.findByText('page:POS')).toBeInTheDocument();
  });
});
