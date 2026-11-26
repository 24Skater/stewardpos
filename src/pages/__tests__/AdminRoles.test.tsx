import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuthSession } from '@/lib/auth';

/**
 * Roles & permissions: who sees the editing controls, what a permission edit
 * sends, and the admin role being undeletable.
 */

const ROLES = [
  { id: 'r-admin', name: 'Administrator', systemRole: 'admin', permissions: {} },
  {
    id: 'r-mgr', name: 'Store Manager', systemRole: 'supervisor',
    permissions: { inventory: { read: true, write: true, delete: false }, orders: { read: true, write: false, delete: false } },
  },
  { id: 'r-x', name: 'Bare', permissions: null },
];

const roles = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
vi.mock('@/lib/api', () => ({ adminApi: { roles } }));

let session: AuthSession | null = null;
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentSession: async () => session };
});

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));
vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/admin/CashierPinManager', () => ({ default: () => <p>PIN manager</p> }));

const { default: AdminRoles } = await import('../admin/AdminRoles');

function makeSession(systemRole: string, permissions: Record<string, unknown> = {}): AuthSession {
  return {
    user: { id: 'u1', email: 'a@shop.test', name: 'A', roleIds: ['r'], roles: [{ id: 'r', name: 'R', systemRole, permissions: permissions as never }] },
    permissions: permissions as never,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminRoles />
    </MemoryRouter>
  );
}

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

/** The read/write/delete checkboxes in the editor row for one module. */
function moduleCheckboxes(module: string) {
  const dialog = screen.getByRole('dialog');
  const row = within(dialog).getByText(module).closest('tr') as HTMLElement;
  return within(row).getAllByRole('checkbox');
}

beforeEach(() => {
  vi.clearAllMocks();
  session = makeSession('admin');
  roles.list.mockResolvedValue(ROLES);
  roles.create.mockResolvedValue({});
  roles.update.mockResolvedValue({});
  roles.remove.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminRoles', () => {
  it('lists roles with their system role and permission count', async () => {
    renderPage();

    expect(await screen.findByText('Store Manager')).toBeInTheDocument();
    expect(within(rowFor('Store Manager')).getByText('3 permissions')).toBeInTheDocument();
    expect(within(rowFor('Bare')).getByText('0 permissions')).toBeInTheDocument();
    expect(within(rowFor('Bare')).getByText('—')).toBeInTheDocument();
    expect(await screen.findByText('PIN manager')).toBeInTheDocument();
  });

  it('filters by name', async () => {
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.change(screen.getByPlaceholderText('Search roles...'), { target: { value: 'zzz' } });

    expect(screen.getByText(/no roles found/i)).toBeInTheDocument();
  });

  it('hides editing controls and the PIN manager from a read-only user', async () => {
    session = makeSession('standard', { users: { read: true } });

    renderPage();
    await screen.findByText('Store Manager');

    expect(screen.queryByRole('button', { name: /add role/i })).not.toBeInTheDocument();
    expect(within(rowFor('Store Manager')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('PIN manager')).not.toBeInTheDocument();
  });

  it('shows the PIN manager to a non-admin who holds users:write', async () => {
    session = makeSession('standard', { users: { read: true, write: true } });

    renderPage();

    expect(await screen.findByText('PIN manager')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add role/i })).not.toBeInTheDocument();
  });

  it('never offers to delete the admin role', async () => {
    renderPage();
    await screen.findByText('Administrator');

    expect(within(rowFor('Administrator')).getAllByRole('button')).toHaveLength(1);
    expect(within(rowFor('Store Manager')).getAllByRole('button')).toHaveLength(2);
  });

  it('surfaces a failure to load roles', async () => {
    roles.list.mockRejectedValue(new Error('Forbidden'));

    renderPage();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Forbidden' })));
  });

  it('requires a name for a new role', async () => {
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.click(screen.getByRole('button', { name: /add role/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Role' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Role name is required' }));
    expect(roles.create).not.toHaveBeenCalled();
  });

  it('creates a role with every resource present and only the granted ones set', async () => {
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.click(screen.getByRole('button', { name: /add role/i }));
    fireEvent.change(await screen.findByLabelText(/role name/i), { target: { value: 'Cashier' } });
    const [ordersRead, ordersWrite] = moduleCheckboxes('orders');
    fireEvent.click(ordersRead);
    fireEvent.click(ordersWrite);
    fireEvent.click(ordersWrite);
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() => expect(roles.create).toHaveBeenCalled());
    const body = roles.create.mock.calls[0][0];
    expect(body.name).toBe('Cashier');
    expect(body.systemRole).toBeUndefined();
    expect(body.permissions.orders).toEqual({ read: true, write: false, delete: false });
    expect(body.permissions.settings).toEqual({ read: false, write: false, delete: false });
    expect(Object.keys(body.permissions)).toHaveLength(11);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Role created successfully' }));
    expect(roles.list).toHaveBeenCalledTimes(2);
  });

  it('edits an existing role, filling missing resources and keeping its grants', async () => {
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.click(within(rowFor('Store Manager')).getAllByRole('button')[0]);
    expect(await screen.findByDisplayValue('Store Manager')).toBeInTheDocument();
    const [, , inventoryDelete] = moduleCheckboxes('inventory');
    fireEvent.click(inventoryDelete);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(roles.update).toHaveBeenCalled());
    const [id, body] = roles.update.mock.calls[0];
    expect(id).toBe('r-mgr');
    expect(body.systemRole).toBe('supervisor');
    expect(body.permissions.inventory).toEqual({ read: true, write: true, delete: true });
    expect(body.permissions.users).toEqual({ read: false, write: false, delete: false });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Role updated successfully' }));
  });

  it('surfaces a save failure and keeps the dialog open', async () => {
    roles.update.mockRejectedValue(new Error('Name in use'));
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.click(within(rowFor('Store Manager')).getAllByRole('button')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Name in use' })));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('deletes a role only after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    await screen.findByText('Store Manager');
    const del = within(rowFor('Store Manager')).getAllByRole('button')[1];

    fireEvent.click(del);
    expect(roles.remove).not.toHaveBeenCalled();

    fireEvent.click(del);
    await waitFor(() => expect(roles.remove).toHaveBeenCalledWith('r-mgr'));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Role deleted successfully' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces a delete failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    roles.remove.mockRejectedValue(new Error('Role has users'));
    renderPage();
    await screen.findByText('Store Manager');

    fireEvent.click(within(rowFor('Store Manager')).getAllByRole('button')[1]);

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Role has users' })));
  });
});
