import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Register settings, driven through the real API layer down to `fetch`.
 *
 * The cash-drawer toggle once failed in production because the browser blocked
 * the `PATCH` it sends (CORS) — the page looked fine and nothing saved. Mocking
 * `registersApi` would hide exactly that, so this file stubs `fetch` instead and
 * asserts the method, URL and body actually leaving the page, and that a
 * transport failure (which is what a CORS block looks like from script: a
 * `TypeError`) reaches the user as a failure rather than vanishing.
 */

const BASE_REGISTER = {
  orgId: 'org1', locationId: 'loc1', placement: null, type: 'fixed', acceptsCash: true, canRefund: true,
  canOpenDrawerNoSale: false, requireSignIn: false, idleLockSeconds: 300, terminalProvider: null,
  terminalDeviceId: null, lastSeenAt: null, createdAt: 0, updatedAt: 0, locationName: 'Main Location',
};
const REGISTERS = [
  { ...BASE_REGISTER, id: 'r1', name: 'Front Counter', registerNumber: 1, displayCode: 'MAIN-01', hasCashDrawer: true, status: 'active', liveness: 'online', lastSeenAt: Date.now() - 60_000 },
  { ...BASE_REGISTER, id: 'r2', name: 'Back Office', registerNumber: 2, displayCode: 'MAIN-02', hasCashDrawer: false, acceptsCash: false, status: 'disabled' },
  { ...BASE_REGISTER, id: 'r3', name: 'Old Till', registerNumber: 3, displayCode: 'MAIN-03', hasCashDrawer: true, status: 'retired' },
];
const LOCATIONS = [
  { id: 'loc1', orgId: 'org1', name: 'Main Location', slug: 'main', address: '1 Main St', city: 'Springfield', state: 'IL', zip: null, timezone: 'UTC', status: 'active', createdAt: 0, updatedAt: 0, registerCount: 3 },
  { id: 'loc2', orgId: 'org1', name: 'Warehouse', slug: 'wh', address: null, city: null, state: null, zip: null, timezone: 'UTC', status: 'active', createdAt: 0, updatedAt: 0, registerCount: 1 },
];

type Handler = (init: RequestInit) => { status?: number; body: unknown } | Promise<never>;
let routes: Record<string, Handler> = {};
const sent: Array<{ method: string; url: string; body: unknown }> = [];

const ok = (data: unknown) => ({ body: { success: true, data } });
const fail = (status: number, error: string) => ({ status, body: { success: false, error } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  sent.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
  const handler = routes[`${method} ${url}`];
  if (!handler) throw new Error(`unrouted ${method} ${url}`);
  const { status = 200, body } = await handler(init);
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
});

let session: unknown = null;
vi.mock('@/hooks/queries/useSession', () => ({
  useSession: () => ({ data: session, isPending: false }),
  useInvalidateSession: () => vi.fn(),
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: AdminRegisters } = await import('../admin/AdminRegisters');

function makeSession(systemRole: string, permissions: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', email: 'a@shop.test', name: 'A', roleIds: ['r'], roles: [{ id: 'r', name: 'R', systemRole, permissions }] },
    permissions,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminRegisters />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const writes = () => sent.filter((r) => r.method !== 'GET');
const toastTitled = (title: string) => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title }));

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  session = makeSession('admin');
  routes = {
    'GET /api/locations': () => ok(LOCATIONS),
    'GET /api/registers': () => ok(REGISTERS),
    'PATCH /api/registers/r1': () => ok(REGISTERS[0]),
  };
  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openEdit(code = 'MAIN-01') {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${code}` }));
  return screen.findByRole('dialog', { name: 'Edit Register' });
}

describe('AdminRegisters — editing register settings', () => {
  it('turning the cash drawer off sends one PATCH with the full settings body', async () => {
    const dialog = await openEdit();
    const [drawer] = within(dialog).getAllByRole('switch');
    expect(drawer).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(drawer);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => toastTitled('Register updated'));
    expect(writes()).toEqual([
      {
        method: 'PATCH',
        url: '/api/registers/r1',
        body: {
          name: 'Front Counter', placement: null, type: 'fixed', hasCashDrawer: false, acceptsCash: true,
          canRefund: true, canOpenDrawerNoSale: false, requireSignIn: false, idleLockSeconds: 300,
        },
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves every capability switch and the idle lock as edited', async () => {
    const dialog = await openEdit();
    within(dialog).getAllByRole('switch').forEach((s) => fireEvent.click(s));
    fireEvent.change(within(dialog).getByLabelText(/idle lock/i), { target: { value: 'x' } });
    fireEvent.change(within(dialog).getByLabelText('Placement'), { target: { value: '  By the door ' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({
      placement: 'By the door', hasCashDrawer: false, acceptsCash: false, canRefund: false,
      canOpenDrawerNoSale: true, requireSignIn: true, idleLockSeconds: 1,
    });
  });

  it('a blocked request (CORS shows up as a TypeError) is reported, and the dialog stays open', async () => {
    routes['PATCH /api/registers/r1'] = () => Promise.reject(new TypeError('Failed to fetch'));
    const dialog = await openEdit();

    fireEvent.click(within(dialog).getAllByRole('switch')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to update register', description: 'Failed to fetch', variant: 'destructive' })
      )
    );
    expect(screen.getByRole('dialog', { name: 'Edit Register' })).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Register updated' }));
  });

  it('a server rejection of the update surfaces the server message', async () => {
    routes['PATCH /api/registers/r1'] = () => fail(400, 'idleLockSeconds must be at least 30');
    const dialog = await openEdit();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to update register', description: 'idleLockSeconds must be at least 30' })
      )
    );
  });

  it('refuses to save a blank name', async () => {
    const dialog = await openEdit();

    fireEvent.change(within(dialog).getByLabelText(/^name \*/i), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    toastTitled('Name is required');
    expect(writes()).toEqual([]);
  });

  it('shows the server-assigned number and code read-only, and Cancel discards edits', async () => {
    const dialog = await openEdit();

    expect(within(dialog).getByLabelText('Register number')).toHaveValue('1');
    expect(within(dialog).getByLabelText('Display code')).toBeDisabled();
    fireEvent.click(within(dialog).getAllByRole('switch')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toEqual([]);
  });
});

describe('AdminRegisters — creating', () => {
  it('creates a register at the location whose button was used', async () => {
    routes['POST /api/registers'] = () => ok({ ...REGISTERS[0], id: 'r9' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Register at Warehouse' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Register' });
    fireEvent.change(within(dialog).getByLabelText(/^name \*/i), { target: { value: ' Pop-up ' } });
    fireEvent.click(within(dialog).getAllByRole('switch')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Register' }));

    await waitFor(() => toastTitled('Register created'));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/registers', body: { locationId: 'loc2', name: 'Pop-up', hasCashDrawer: false },
    });
  });

  it('reports a generic create failure', async () => {
    routes['POST /api/registers'] = () => fail(500, 'boom');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Register at Main Location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Register' });
    fireEvent.change(within(dialog).getByLabelText(/^name \*/i), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Register' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to create register', description: 'boom' }))
    );
  });

  it('adds a location with blanks sent as null', async () => {
    routes['POST /api/locations'] = () => ok(LOCATIONS[1]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Location' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Location' }));
    toastTitled('Name is required');

    fireEvent.change(within(dialog).getByLabelText(/^name \*/i), { target: { value: 'Kiosk' } });
    fireEvent.change(within(dialog).getByLabelText('Address'), { target: { value: '9 Mall Rd' } });
    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Shelbyville' } });
    fireEvent.change(within(dialog).getByLabelText('State'), { target: { value: 'IL' } });
    fireEvent.change(within(dialog).getByLabelText('ZIP'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Timezone'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Location' }));

    await waitFor(() => toastTitled('Location created'));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/locations',
      body: { name: 'Kiosk', address: '9 Mall Rd', city: 'Shelbyville', state: 'IL', zip: null },
    });
  });

  it('reports a location create failure', async () => {
    routes['POST /api/locations'] = () => fail(409, 'Slug taken');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Location' });
    fireEvent.change(within(dialog).getByLabelText(/^name \*/i), { target: { value: 'Main' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Location' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to create location', description: 'Slug taken' }))
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('AdminRegisters — lifecycle actions', () => {
  it('offers only the actions each status allows', async () => {
    renderPage();
    await screen.findByText('MAIN-03');

    expect(screen.getByRole('button', { name: 'Disable MAIN-01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate MAIN-01' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate MAIN-02' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open MAIN-02' })).not.toBeInTheDocument();
    // A retired register is a tombstone: nothing to do to it.
    expect(screen.queryByRole('button', { name: /MAIN-03/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 Main St, Springfield, IL')).toBeInTheDocument();
    expect(screen.getByText('No address on file')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('disables and activates, reporting each outcome', async () => {
    routes['POST /api/registers/r1/disable'] = () => ok(REGISTERS[0]);
    routes['POST /api/registers/r2/activate'] = () => fail(500, 'nope');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Disable MAIN-01' }));
    await waitFor(() => toastTitled('MAIN-01 disabled'));

    fireEvent.click(screen.getByRole('button', { name: 'Activate MAIN-02' }));
    await waitFor(() => toastTitled('Failed to activate register'));
  });

  it('reports a failed disable and a successful activate', async () => {
    routes['POST /api/registers/r1/disable'] = () => fail(500, 'nope');
    routes['POST /api/registers/r2/activate'] = () => ok(REGISTERS[1]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Disable MAIN-01' }));
    await waitFor(() => toastTitled('Failed to disable register'));

    fireEvent.click(screen.getByRole('button', { name: 'Activate MAIN-02' }));
    await waitFor(() => toastTitled('MAIN-02 activated'));
  });

  it('reports a failed retire', async () => {
    routes['POST /api/registers/r1/retire'] = () => fail(500, 'nope');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Retire MAIN-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retire register' }));

    await waitFor(() => toastTitled('Failed to retire register'));
  });

  it('copies a fresh pairing code, and reports a failure to mint one', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    routes['POST /api/registers/r1/pairing-code'] = () =>
      ok({ code: 'ABCD2345', formattedCode: 'ABCD-2345', expiresAt: Date.now() + 900_000, registerId: 'r1' });
    routes['POST /api/registers/r2/pairing-code'] = () => fail(500, 'nope');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate pairing code for MAIN-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy pairing code' }));
    expect(writeText).toHaveBeenCalledWith('ABCD-2345');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('ABCD-2345')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Generate pairing code for MAIN-02' }));
    await waitFor(() => toastTitled('Failed to generate pairing code'));
  });

  it('reports a revoke that fails for a reason other than an open drawer', async () => {
    routes['POST /api/registers/r1/revoke'] = () => fail(500, 'nope');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MAIN-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke register' }));

    await waitFor(() => toastTitled('Failed to revoke register'));
  });

  it('revokes cleanly, and reports a forced revoke that still fails', async () => {
    let calls = 0;
    routes['POST /api/registers/r1/revoke'] = () => {
      calls += 1;
      return calls === 1 ? ok({ register: REGISTERS[0], closedDrawerSession: null }) : fail(409, 'open drawer');
    };
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MAIN-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke register' }));
    await waitFor(() => toastTitled('MAIN-01 revoked'));

    fireEvent.click(screen.getByRole('button', { name: 'Revoke MAIN-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke register' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close drawer and revoke' }));
    await waitFor(() => toastTitled('Failed to revoke register'));
  });
});

describe('AdminRegisters — access and load states', () => {
  it('shows no write or delete controls to a read-only user', async () => {
    session = makeSession('standard', { registers: { read: true } });
    renderPage();

    await screen.findByText('MAIN-01');

    expect(screen.queryByRole('button', { name: 'Add Location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit main-01/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('says so when there are no locations', async () => {
    routes['GET /api/locations'] = () => ok([]);
    routes['GET /api/registers'] = () => ok([]);
    renderPage();

    expect(await screen.findByText(/no locations yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Register' })).toBeDisabled();
  });

  it('shows the load error and retries both queries', async () => {
    routes['GET /api/locations'] = () => fail(500, 'Database unavailable');
    renderPage();

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    routes['GET /api/locations'] = () => ok(LOCATIONS);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('MAIN-01')).toBeInTheDocument();
  });
});
