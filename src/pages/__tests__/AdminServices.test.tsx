import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuthSession } from '@/lib/auth';

/** The services catalog: search, permission-gated controls, create/edit/delete. */

const SERVICES = [
  { id: 's1', name: 'Photo Session', category: 'Media', description: 'One hour', basePrice: 150, unitType: 'hourly', isActive: true, createdAt: 0, updatedAt: 0 },
  { id: 's2', name: 'Consult', category: 'Advice', description: '', basePrice: 0, unitType: '', isActive: false, createdAt: 0, updatedAt: 0 },
];

const servicesApi = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
vi.mock('@/lib/api', () => ({ servicesApi }));

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

const { default: AdminServices } = await import('../admin/AdminServices');

function makeSession(permissions: Record<string, unknown>, systemRole = 'standard'): AuthSession {
  return {
    user: { id: 'u', email: 'u@x', name: 'U', roleIds: ['r'], roles: [{ id: 'r', name: 'R', systemRole, permissions: permissions as never }] },
    permissions: permissions as never,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminServices />
    </MemoryRouter>
  );
}

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  session = makeSession({}, 'admin');
  servicesApi.list.mockResolvedValue(SERVICES);
  servicesApi.create.mockResolvedValue({});
  servicesApi.update.mockResolvedValue({});
  servicesApi.remove.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminServices', () => {
  it('lists services with price, unit and status', async () => {
    renderPage();

    expect(await screen.findByText('Photo Session')).toBeInTheDocument();
    expect(within(rowFor('Photo Session')).getByText('$150.00')).toBeInTheDocument();
    expect(within(rowFor('Photo Session')).getByText('Active')).toBeInTheDocument();
    expect(within(rowFor('Consult')).getAllByText('—')).toHaveLength(2);
    expect(within(rowFor('Consult')).getByText('Inactive')).toBeInTheDocument();
  });

  it('searches by name or category', async () => {
    renderPage();
    await screen.findByText('Photo Session');
    const search = screen.getByPlaceholderText('Search services...');

    fireEvent.change(search, { target: { value: 'advice' } });
    expect(screen.queryByText('Photo Session')).not.toBeInTheDocument();
    expect(screen.getByText('Consult')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/no services found/i)).toBeInTheDocument();
  });

  it('shows no controls to a read-only user', async () => {
    session = makeSession({ services: { read: true } });
    renderPage();
    await screen.findByText('Photo Session');

    expect(screen.queryByRole('button', { name: /add service/i })).not.toBeInTheDocument();
    expect(within(rowFor('Photo Session')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows only delete to a user with services:delete but not write', async () => {
    session = makeSession({ services: { read: true, delete: true } });
    renderPage();
    await screen.findByText('Photo Session');

    expect(screen.queryByRole('button', { name: /add service/i })).not.toBeInTheDocument();
    expect(within(rowFor('Photo Session')).getAllByRole('button')).toHaveLength(1);
  });

  it('surfaces a failure to load', async () => {
    servicesApi.list.mockRejectedValue(new Error('Down'));
    renderPage();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Down' })));
  });

  it('requires a name and category', async () => {
    renderPage();
    await screen.findByText('Photo Session');

    fireEvent.click(screen.getByRole('button', { name: /add service/i }));
    fireEvent.change(await screen.findByLabelText(/service name/i), { target: { value: 'Only name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Service' }));

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Name and category are required' }));
    expect(servicesApi.create).not.toHaveBeenCalled();
  });

  it('creates a service with what was entered', async () => {
    renderPage();
    await screen.findByText('Photo Session');

    fireEvent.click(screen.getByRole('button', { name: /add service/i }));
    fireEvent.change(await screen.findByLabelText(/service name/i), { target: { value: 'Mixing' } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'Audio' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Stereo mixdown' } });
    fireEvent.change(screen.getByLabelText('Base Price'), { target: { value: '75.5' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Service' }));

    await waitFor(() =>
      expect(servicesApi.create).toHaveBeenCalledWith({
        name: 'Mixing', category: 'Audio', description: 'Stereo mixdown', basePrice: 75.5, unitType: 'flat', isActive: false,
      })
    );
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Service created successfully' }));
    expect(servicesApi.list).toHaveBeenCalledTimes(2);
  });

  it('edits an existing service', async () => {
    renderPage();
    await screen.findByText('Photo Session');

    fireEvent.click(within(rowFor('Photo Session')).getAllByRole('button')[0]);
    const price = await screen.findByLabelText('Base Price');
    fireEvent.change(price, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(servicesApi.update).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Photo Session', basePrice: 0, unitType: 'hourly' }))
    );
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Service updated successfully' }));
  });

  it('surfaces a save failure and Cancel closes the dialog', async () => {
    servicesApi.update.mockRejectedValue(new Error('Conflict'));
    renderPage();
    await screen.findByText('Photo Session');

    fireEvent.click(within(rowFor('Photo Session')).getAllByRole('button')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'Conflict' })));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('deletes only after confirming, and reports a failure', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderPage();
    await screen.findByText('Photo Session');
    const del = () => within(rowFor('Photo Session')).getAllByRole('button')[1];

    fireEvent.click(del());
    expect(servicesApi.remove).not.toHaveBeenCalled();

    fireEvent.click(del());
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Service deleted successfully' }));
    expect(servicesApi.remove).toHaveBeenCalledWith('s1');

    servicesApi.remove.mockRejectedValueOnce(new Error('In use on a quote'));
    fireEvent.click(del());
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: 'In use on a quote' })));
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });
});
