import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { ApiClientError } from '@/lib/api-client';

/**
 * AdminRegisters behaviour, not just render.
 *
 * `adminPages.render.test.tsx` proves the page mounts against an empty
 * backend. This file drives the parts a store manager actually depends on:
 * registers grouped by the location they physically sit at, a drawer-less
 * register reading as such without expanding anything, retiring asking
 * before it acts (retiring never releases a register's number or code), and
 * the org's register cap surfacing its own message instead of a generic one.
 */

const calls: string[] = [];

const LOCATIONS = [
  {
    id: 'loc1',
    orgId: 'org1',
    name: 'Main Location',
    slug: 'main',
    address: '100 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    timezone: 'UTC',
    status: 'active' as const,
    createdAt: 0,
    updatedAt: 0,
    registerCount: 2,
  },
  {
    id: 'loc2',
    orgId: 'org1',
    name: 'Warehouse',
    slug: 'warehouse',
    address: null,
    city: null,
    state: null,
    zip: null,
    timezone: 'UTC',
    status: 'active' as const,
    createdAt: 0,
    updatedAt: 0,
    registerCount: 0,
  },
];

const REGISTERS = [
  {
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
    requireSignIn: false,
    idleLockSeconds: 300,
    terminalProvider: null,
    terminalDeviceId: null,
    status: 'active' as const,
    lastSeenAt: null,
    createdAt: 0,
    updatedAt: 0,
    locationName: 'Main Location',
  },
  {
    id: 'r2',
    orgId: 'org1',
    locationId: 'loc1',
    name: 'Web Checkout',
    registerNumber: 2,
    displayCode: 'MAIN-02',
    placement: null,
    type: 'web' as const,
    hasCashDrawer: false,
    acceptsCash: false,
    canRefund: true,
    canOpenDrawerNoSale: false,
    requireSignIn: false,
    idleLockSeconds: 300,
    terminalProvider: null,
    terminalDeviceId: null,
    status: 'active' as const,
    lastSeenAt: null,
    createdAt: 0,
    updatedAt: 0,
    locationName: 'Main Location',
  },
];

vi.mock('@/lib/api', () => ({
  registersApi: {
    list: vi.fn(async () => {
      calls.push('registersApi.list');
      return REGISTERS;
    }),
    get: vi.fn(async () => REGISTERS[0]),
    create: vi.fn(async (body: Record<string, unknown>) => {
      calls.push('registersApi.create');
      return { ...REGISTERS[0], ...body, id: 'new-register' };
    }),
    update: vi.fn(async () => {
      calls.push('registersApi.update');
      return REGISTERS[0];
    }),
    retire: vi.fn(async (id: string) => {
      calls.push('registersApi.retire');
      return { ...REGISTERS[0], id, status: 'retired' };
    }),
    disable: vi.fn(async () => {
      calls.push('registersApi.disable');
      return REGISTERS[0];
    }),
    activate: vi.fn(async () => {
      calls.push('registersApi.activate');
      return REGISTERS[0];
    }),
    pairingCode: vi.fn(async (id: string) => {
      calls.push('registersApi.pairingCode');
      return { code: 'ABCD2345', formattedCode: 'ABCD-2345', expiresAt: Date.now() + 15 * 60_000, registerId: id };
    }),
    pair: vi.fn(async () => {
      calls.push('registersApi.pair');
      return { token: 'srt_test_secret', register: REGISTERS[0] };
    }),
    heartbeat: vi.fn(async () => {
      calls.push('registersApi.heartbeat');
      return REGISTERS[0];
    }),
    revoke: vi.fn(async (id: string) => {
      calls.push('registersApi.revoke');
      return { register: { ...REGISTERS[0], id, status: 'pending' }, closedDrawerSession: null };
    }),
  },
  locationsApi: {
    list: vi.fn(async () => {
      calls.push('locationsApi.list');
      return LOCATIONS;
    }),
    get: vi.fn(async () => LOCATIONS[0]),
    create: vi.fn(async () => {
      calls.push('locationsApi.create');
      return LOCATIONS[0];
    }),
    update: vi.fn(async () => {
      calls.push('locationsApi.update');
      return LOCATIONS[0];
    }),
  },
}));

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
  calls.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

const TIMEOUT = 20_000;

describe('AdminRegisters', () => {
  it('groups registers under their location, each with its own heading', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    expect(await screen.findByRole('heading', { level: 2, name: 'Main Location' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Warehouse' })).toBeInTheDocument();

    // Both of loc1's registers render under it.
    expect(screen.getByText('MAIN-01')).toBeInTheDocument();
    expect(screen.getByText('MAIN-02')).toBeInTheDocument();

    // The empty location says so rather than showing nothing.
    expect(screen.getByText(/no registers at this location yet/i)).toBeInTheDocument();
  }, TIMEOUT);

  it('makes a drawer-less register visually obvious without expanding it', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    await screen.findByText('MAIN-02');

    // Both read directly off the row — no click, no expansion.
    expect(screen.getByText('No cash drawer')).toBeInTheDocument();
    expect(screen.getByText('Cash drawer')).toBeInTheDocument();
  }, TIMEOUT);

  it('confirms before retiring, and only retires after confirming', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    const retireButton = await screen.findByRole('button', { name: 'Retire MAIN-01' });
    fireEvent.click(retireButton);

    // The dialog is up, but nothing has been sent to the API yet.
    expect(await screen.findByText(/permanent/i)).toBeInTheDocument();
    expect(calls).not.toContain('registersApi.retire');

    fireEvent.click(screen.getByRole('button', { name: 'Retire register' }));

    await waitFor(() => expect(calls).toContain('registersApi.retire'));
  }, TIMEOUT);

  it('surfaces the register-cap message instead of a generic failure toast', async () => {
    const { registersApi } = await import('@/lib/api');
    const CAP_MESSAGE = "Your organization's register limit of 3 has been reached";
    vi.mocked(registersApi.create).mockRejectedValueOnce(new ApiClientError(422, CAP_MESSAGE));

    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    // Locations have to be loaded before "Add Register" is enabled — it needs
    // a location to default to.
    await screen.findByRole('heading', { level: 2, name: 'Main Location' });

    fireEvent.click(screen.getByRole('button', { name: 'Add Register' }));

    const name = await screen.findByLabelText(/^name \*/i);
    fireEvent.change(name, { target: { value: 'Second Front Counter' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Register' }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Register limit reached',
          description: CAP_MESSAGE,
        })
      );
    });

    // Not the generic fallback a caller would get without special-casing 422.
    const genericFailure = toastSpy.mock.calls.some(
      ([arg]) => arg?.title === 'Failed to create register'
    );
    expect(genericFailure).toBe(false);
  }, TIMEOUT);

  it('shows a pairing code once it is generated, large and copyable, with its expiry', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    const pairButton = await screen.findByRole('button', { name: 'Generate pairing code for MAIN-01' });
    fireEvent.click(pairButton);

    await waitFor(() => expect(calls).toContain('registersApi.pairingCode'));
    expect(await screen.findByText('ABCD-2345')).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  }, TIMEOUT);

  it('confirms before revoking, and only revokes after confirming', async () => {
    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    const revokeButton = await screen.findByRole('button', { name: 'Revoke MAIN-01' });
    fireEvent.click(revokeButton);

    // The dialog is up, but nothing has been sent to the API yet.
    expect(await screen.findByText(/must be paired again/i)).toBeInTheDocument();
    expect(calls).not.toContain('registersApi.revoke');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke register' }));

    await waitFor(() => expect(calls).toContain('registersApi.revoke'));
    expect(vi.mocked((await import('@/lib/api')).registersApi.revoke)).toHaveBeenCalledWith('r1', undefined);
  }, TIMEOUT);

  it('explains the open drawer and offers the force path on a 409, instead of a generic failure', async () => {
    const { registersApi } = await import('@/lib/api');
    vi.mocked(registersApi.revoke).mockRejectedValueOnce(
      new ApiClientError(409, 'Register MAIN-01 has an open drawer session (opened 2026-01-01T00:00:00.000Z). Pass force: true to close it and revoke anyway.')
    );

    const { default: Page } = await import('../admin/AdminRegisters');
    renderPage(Page);

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MAIN-01' }));
    await screen.findByText(/must be paired again/i);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke register' }));

    // Not a generic failure toast - the specific open-drawer explanation and the force path.
    expect(await screen.findByText(/open cash drawer/i)).toBeInTheDocument();
    expect(screen.getByText(/flag it for review/i)).toBeInTheDocument();
    expect(
      toastSpy.mock.calls.some(([arg]) => arg?.title === 'Failed to revoke register')
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer and revoke' }));

    await waitFor(() =>
      expect(registersApi.revoke).toHaveBeenLastCalledWith('r1', { force: true })
    );
  }, TIMEOUT);
});
