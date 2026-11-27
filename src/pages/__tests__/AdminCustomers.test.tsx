import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import AdminCustomers from '../admin/AdminCustomers';

const api = vi.hoisted(() => ({
  customers: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    purge: vi.fn(),
    remove: vi.fn(),
  },
  quotes: { listByCustomer: vi.fn() },
  returns: { listByCustomer: vi.fn() },
  orders: { listByCustomerEmail: vi.fn(), listByCustomerPhone: vi.fn() },
  session: { current: null as unknown },
  toasts: [] as { title?: string; description?: string }[],
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  customersApi: api.customers,
  quotesApi: api.quotes,
  returnsApi: api.returns,
  ordersApi: api.orders,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentSession: vi.fn(async () => api.session.current),
}));

vi.mock('@/hooks/use-toast', () => {
  const toast = (m: { title?: string; description?: string }) => api.toasts.push(m);
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const ADMIN = {
  user: {
    id: 'u1',
    email: 'a@x.test',
    name: 'Admin',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  },
  permissions: {},
};

const ADA = {
  id: 'c1',
  name: 'Ada Lovelace',
  org: 'Analytical Engines',
  email: 'ada@example.com',
  phone: '555-0101',
  city: 'London',
  state: 'LDN',
  zip: 'N1',
  address: '1 Engine Way',
  country: 'UK',
  notes: 'Prefers email',
  tags: [],
  lifetimeValue: 0,
  createdAt: 2,
  updatedAt: 2,
};
const BOB = { id: 'c2', name: 'Bob Baker', city: 'Paris', createdAt: 1, updatedAt: 1 };

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminCustomers />
    </MemoryRouter>
  );
}

const lastToast = () => api.toasts.at(-1);

async function openDeleteFor(name: string) {
  const row = (await screen.findByText(name)).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByTitle('Delete/Archive'));
  return screen.findByRole('alertdialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.toasts.length = 0;
  api.session.current = ADMIN;
  api.customers.list.mockResolvedValue([BOB, ADA]);
  api.customers.create.mockResolvedValue({});
  api.customers.update.mockResolvedValue({});
  api.customers.archive.mockResolvedValue({});
  api.customers.purge.mockResolvedValue({});
  api.customers.remove.mockResolvedValue({});
  api.quotes.listByCustomer.mockResolvedValue([]);
  api.returns.listByCustomer.mockResolvedValue([]);
  api.orders.listByCustomerEmail.mockResolvedValue([]);
  api.orders.listByCustomerPhone.mockResolvedValue([]);
});

describe('AdminCustomers list', () => {
  it('lists customers newest first with location formatted', async () => {
    renderPage();

    await screen.findByText('Ada Lovelace');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('Ada Lovelace');
    expect(rows[0].textContent).toContain('London, LDN');
    expect(rows[1].textContent).toContain('Bob Baker');
    expect(rows[1].textContent).toContain('Paris');
  });

  it('filters by name, email, organisation and phone', async () => {
    renderPage();
    await screen.findByText('Ada Lovelace');
    const search = screen.getByPlaceholderText('Search customers...');

    fireEvent.change(search, { target: { value: 'analytical' } });
    expect(screen.queryByText('Bob Baker')).toBeNull();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();

    fireEvent.change(search, { target: { value: '0101' } });
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText(/no customers found/i)).toBeTruthy();
  });

  it('shows a toast when the customer list fails to load', async () => {
    api.customers.list.mockRejectedValue(new Error('db down'));

    renderPage();

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Error', description: 'db down' }));
  });

  it('hides write and delete controls from a signed-out viewer', async () => {
    api.session.current = null;

    renderPage();

    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('button', { name: /add customer/i })).toBeNull();
    expect(screen.queryAllByTitle('Delete/Archive')).toHaveLength(0);
  });
});

describe('AdminCustomers create / edit', () => {
  it('refuses to save a customer with no name', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add customer/i }));

    fireEvent.click(await screen.findByRole('button', { name: /create customer/i }));

    expect(lastToast()).toMatchObject({ description: 'Customer name is required' });
    expect(api.customers.create).not.toHaveBeenCalled();
  });

  it('creates a customer with typed fields and blanks sent as undefined', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add customer/i }));

    const fields: Record<string, string> = {
      'Name *': 'Grace Hopper',
      Organization: 'Navy',
      Email: 'grace@navy.test',
      Phone: '555',
      Address: '2 Cobol Rd',
      City: 'Arlington',
      State: 'VA',
      ZIP: '22201',
      Country: 'USA',
      Notes: 'VIP',
    };
    for (const [label, value] of Object.entries(fields)) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));

    await waitFor(() =>
      expect(api.customers.create).toHaveBeenCalledWith({
        name: 'Grace Hopper',
        org: 'Navy',
        email: 'grace@navy.test',
        phone: '555',
        address: '2 Cobol Rd',
        city: 'Arlington',
        state: 'VA',
        zip: '22201',
        country: 'USA',
        notes: undefined,
      })
    );
    expect(lastToast()?.title).toBe('Customer created successfully');
    expect(api.customers.list).toHaveBeenCalledTimes(2);
  });

  it('updates an existing customer by id', async () => {
    renderPage();
    await screen.findByText('Ada Lovelace');
    const row = screen.getByText('Ada Lovelace').closest('tr') as HTMLElement;
    const [, edit] = within(row).getAllByRole('button');
    fireEvent.click(edit);

    const name = await screen.findByLabelText('Name *');
    expect((name as HTMLInputElement).value).toBe('Ada Lovelace');
    fireEvent.change(name, { target: { value: 'Ada King' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(api.customers.update).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'Ada King' }))
    );
    expect(lastToast()?.title).toBe('Customer updated successfully');
  });

  it('reports a failed save', async () => {
    api.customers.create.mockRejectedValue(new Error('duplicate email'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add customer/i }));

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'duplicate email' }));
  });
});

describe('AdminCustomers detail view', () => {
  it('loads history and computes net value from orders, completed quotes and completed returns', async () => {
    api.orders.listByCustomerEmail.mockResolvedValue([
      {
        id: 'o1',
        createdAt: 0,
        total: 100,
        paymentMethod: 'cash',
        items: [
          { quantity: 1, nameSnapshot: 'Tea' },
          { quantity: 2, nameSnapshot: 'Mug' },
          { quantity: 3, nameSnapshot: 'Spoon' },
        ],
      },
    ]);
    api.quotes.listByCustomer.mockResolvedValue([
      { id: 'q1', createdAt: 0, status: 'completed', total: 50, items: [{ description: 'Repair', quantity: 1, lineTotal: 50 }] },
      { id: 'q2', createdAt: 0, status: 'draft', total: 999, items: [] },
    ]);
    api.returns.listByCustomer.mockResolvedValue([
      { id: 'r1', returnNumber: 'RET-1', returnType: 'refund', status: 'completed', refundStatus: 'processed', total: 20, createdAt: 0 },
      { id: 'r2', returnNumber: 'RET-2', returnType: 'exchange', status: 'pending', refundStatus: 'pending', total: 5, createdAt: 0 },
    ]);
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;

    fireEvent.click(within(row).getAllByRole('button')[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('$130.00')).toBeTruthy());
    expect(within(dialog).getByText('$100.00')).toBeTruthy();
    expect(within(dialog).getByText('$50.00')).toBeTruthy();
    expect(within(dialog).getByText('-$20.00')).toBeTruthy();
    expect(within(dialog).getByText('2 return(s)')).toBeTruthy();
    expect(within(dialog).getByText('Prefers email')).toBeTruthy();
    expect(api.orders.listByCustomerEmail).toHaveBeenCalledWith('ada@example.com');
  });

  it('also finds sales recorded by phone, listing a sale matched both ways once', async () => {
    const both = { id: 'o1', createdAt: 1, total: 10, paymentMethod: 'cash', items: [] };
    const phoneOnly = { id: 'o2', createdAt: 2, total: 5, paymentMethod: 'cash', items: [] };
    api.orders.listByCustomerEmail.mockResolvedValue([both]);
    api.orders.listByCustomerPhone.mockResolvedValue([phoneOnly, both]);
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;

    fireEvent.click(within(row).getAllByRole('button')[0]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/POS Orders \(2\)/)).toBeTruthy();
    expect(api.orders.listByCustomerPhone).toHaveBeenCalledWith('555-0101');
  });

  it('shows each history tab', async () => {
    api.orders.listByCustomerEmail.mockResolvedValue([
      { id: 'o1', createdAt: 0, total: 9, paymentMethod: 'card', items: [{ quantity: 1, nameSnapshot: 'Tea' }, { quantity: 1, nameSnapshot: 'A' }, { quantity: 1, nameSnapshot: 'B' }] },
    ]);
    api.quotes.listByCustomer.mockResolvedValue([
      { id: 'q1', createdAt: 0, status: 'rejected', total: 5, items: [{ description: 'Fix', quantity: 1, lineTotal: 1 }, { description: 'B', quantity: 1, lineTotal: 1 }, { description: 'C', quantity: 1, lineTotal: 1 }] },
    ]);
    api.returns.listByCustomer.mockResolvedValue([
      { id: 'r1', returnNumber: 'RET-9', returnType: 'refund', status: 'rejected', refundStatus: 'pending', total: 1, createdAt: 0 },
      { id: 'r2', returnNumber: 'RET-8', returnType: 'refund', status: 'other', refundStatus: 'pending', total: 1, createdAt: 0 },
    ]);
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/POS Orders \(1\)/);

    const openTab = (name: RegExp) => {
      const tab = within(dialog).getByRole('tab', { name });
      fireEvent.mouseDown(tab);
      fireEvent.click(tab);
    };

    openTab(/pos orders/i);
    expect(await within(dialog).findByText('1x Tea')).toBeTruthy();
    expect(within(dialog).getByText('+1 more')).toBeTruthy();

    openTab(/service quotes/i);
    expect(await within(dialog).findByText('1x Fix')).toBeTruthy();
    expect(within(dialog).getByText('rejected')).toBeTruthy();

    openTab(/returns/i);
    expect(await within(dialog).findByText('RET-9')).toBeTruthy();
  });

  it('skips the order lookup for a customer without email and shows empty tabs', async () => {
    renderPage();
    const row = (await screen.findByText('Bob Baker')).closest('tr') as HTMLElement;

    fireEvent.click(within(row).getAllByRole('button')[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(api.returns.listByCustomer).toHaveBeenCalledWith('c2'));
    expect(api.orders.listByCustomerEmail).not.toHaveBeenCalled();
    const tab = within(dialog).getByRole('tab', { name: /returns/i });
    fireEvent.mouseDown(tab);
    expect(await within(dialog).findByText(/no returns found/i)).toBeTruthy();
  });

  it('jumps from the detail view into editing', async () => {
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getAllByRole('button')[0]);

    fireEvent.click(await screen.findByRole('button', { name: /edit customer/i }));

    expect(((await screen.findByLabelText('Name *')) as HTMLInputElement).value).toBe('Ada Lovelace');
  });
});

describe('AdminCustomers delete / archive', () => {
  it('deletes directly when the customer has no related records', async () => {
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');

    fireEvent.click(within(dialog).getByRole('button', { name: /try simple delete/i }));

    await waitFor(() => expect(api.customers.remove).toHaveBeenCalledWith('c1'));
    expect(lastToast()?.title).toBe('Customer deleted successfully');
  });

  it('falls back to archive options when the server says records are associated', async () => {
    api.customers.remove.mockRejectedValue(new Error('Customer has associated orders'));
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');

    fireEvent.click(within(dialog).getByRole('button', { name: /try simple delete/i }));

    await waitFor(() => expect(lastToast()?.title).toBe('Cannot delete directly'));
    expect(await screen.findByLabelText(/reason for archiving/i)).toBeTruthy();
  });

  it('reports other simple-delete failures as errors', async () => {
    api.customers.remove.mockRejectedValue(new Error('forbidden'));
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');

    fireEvent.click(within(dialog).getByRole('button', { name: /try simple delete/i }));

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Error', description: 'forbidden' }));
  });

  it('archives with the typed reason', async () => {
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');

    fireEvent.click(within(dialog).getByText('Archive Customer'));
    fireEvent.change(screen.getByLabelText(/reason for archiving/i), { target: { value: 'moved away' } });
    fireEvent.click(screen.getByRole('button', { name: /archive customer/i }));

    await waitFor(() => expect(api.customers.archive).toHaveBeenCalledWith('c1', 'moved away'));
    expect(lastToast()?.title).toBe('Customer archived');
  });

  it('reports a failed archive and lets the admin go back', async () => {
    api.customers.archive.mockRejectedValue(new Error('nope'));
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');
    fireEvent.click(within(dialog).getByText('Archive Customer'));

    fireEvent.click(screen.getByRole('button', { name: /archive customer/i }));
    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'nope' }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByRole('button', { name: /try simple delete/i })).toBeTruthy();
  });

  it('lets an admin permanently delete after a warning', async () => {
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');

    fireEvent.click(within(dialog).getByText('Permanent Delete'));
    expect(screen.getByText(/this action is irreversible/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /permanently delete/i }));

    await waitFor(() => expect(api.customers.purge).toHaveBeenCalledWith('c1'));
    expect(lastToast()?.title).toBe('Customer deleted');
  });

  it('reports a failed permanent delete', async () => {
    api.customers.purge.mockRejectedValue(new Error('locked'));
    renderPage();
    const dialog = await openDeleteFor('Ada Lovelace');
    fireEvent.click(within(dialog).getByText('Permanent Delete'));

    fireEvent.click(screen.getByRole('button', { name: /permanently delete/i }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'locked' }));
  });
});
