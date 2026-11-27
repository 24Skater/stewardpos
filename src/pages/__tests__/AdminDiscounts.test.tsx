import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import AdminDiscounts from '../admin/AdminDiscounts';

const m = vi.hoisted(() => ({
  types: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  promos: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  employee: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  stats: vi.fn(),
  users: { list: vi.fn() },
  toasts: [] as { title?: string; variant?: string }[],
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discountsApi: { types: m.types, promos: m.promos, employee: m.employee, stats: m.stats },
  adminApi: { users: m.users },
}));

vi.mock('@/hooks/use-toast', () => {
  const toast = (t: { title?: string; variant?: string }) => m.toasts.push(t);
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  // Radix Select needs these and jsdom lacks them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const DAY = 86_400_000;
const NOW = Date.now();

const SENIOR = {
  id: 't1', name: 'Senior', code: 'SENIOR', description: '65+', discountType: 'percentage', discountValue: 10,
  minPurchase: 0, maxDiscount: 25, appliesTo: 'all', applicableIds: [], requiresApproval: true,
  approvalThreshold: 50, requiresEmployeeId: false, displayOrder: 1, color: 'blue', icon: 'user',
  showInPos: true, isActive: true, createdAt: 0,
};
const MILITARY = { ...SENIOR, id: 't2', name: 'Military', code: undefined, discountType: 'fixed', discountValue: 5,
  requiresApproval: false, showInPos: false, isActive: false, color: 'nope', icon: undefined, maxDiscount: null, approvalThreshold: null };

const promo = (over: Record<string, unknown>) => ({
  id: 'p', code: 'CODE', name: 'Promo', discountType: 'percentage', discountValue: 10, minPurchase: 0,
  maxUses: null, maxUsesPerCustomer: 1, currentUses: 0, startsAt: NOW - DAY, expiresAt: null,
  firstOrderOnly: false, stackable: false, isActive: true, createdAt: 0, ...over,
});
const PROMOS = [
  promo({ id: 'p1', code: 'LIVE', name: 'Live one', description: 'desc', minPurchase: 20, maxUses: 100, currentUses: 3, expiresAt: NOW + DAY, maxDiscount: 15 }),
  promo({ id: 'p2', code: 'OFF', name: 'Turned off', isActive: false }),
  promo({ id: 'p3', code: 'OLD', name: 'Expired', expiresAt: NOW - 1000 }),
  promo({ id: 'p4', code: 'SOON', name: 'Future', startsAt: NOW + DAY, discountType: 'fixed', firstOrderOnly: true }),
  promo({ id: 'p5', code: 'GONE', name: 'Used up', maxUses: 2, currentUses: 2 }),
];
const EMP = [
  { id: 'e1', userId: 'u1', userName: 'Pat', userEmail: 'pat@x.test', discountPercentage: 20, maxDiscountAmount: 100,
    currentMonthUsage: 12.5, requiresManagerApprovalAbove: 40, isActive: true },
  { id: 'e2', userId: 'u2', userName: 'Sam', userEmail: 'sam@x.test', discountPercentage: 5, maxDiscountAmount: null,
    currentMonthUsage: 0, requiresManagerApprovalAbove: null, isActive: false },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminDiscounts />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function openTab(name: RegExp) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

/** Opens a Radix Select by its current-value trigger and picks an option. */
function pick(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

const lastToast = () => m.toasts.at(-1)?.title;

beforeEach(() => {
  vi.clearAllMocks();
  m.toasts.length = 0;
  m.types.list.mockResolvedValue([SENIOR, MILITARY]);
  m.promos.list.mockResolvedValue(PROMOS);
  m.employee.list.mockResolvedValue(EMP);
  m.stats.mockResolvedValue({ totalDiscounts: 7, totalDiscountAmount: 123.4 });
  m.users.list.mockResolvedValue([{ id: 'u9', name: 'Lee', email: 'lee@x.test' }]);
  for (const fn of [m.types.create, m.types.update, m.types.remove, m.promos.create, m.promos.update,
    m.promos.remove, m.employee.upsert, m.employee.remove]) fn.mockResolvedValue({});
});

describe('AdminDiscounts summary and quick discounts', () => {
  it('shows stats, active counts and the quick discount cards', async () => {
    renderPage();

    expect(await screen.findByText('$123.40')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    await screen.findByText('Military');
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.getByText('$5')).toBeTruthy();
    expect(screen.getByText('Code: SENIOR')).toBeTruthy();
    expect(screen.getByText('Visible in POS')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getByText(/requires manager approval/i)).toBeTruthy();
  });

  it('filters quick discounts by name or code', async () => {
    renderPage();
    await screen.findByText('Military');

    fireEvent.change(screen.getByPlaceholderText(/search discounts/i), { target: { value: 'senior' } });
    expect(screen.queryByText('Military')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/search discounts/i), { target: { value: 'zzz' } });
    expect(screen.getByText('No quick discounts found')).toBeTruthy();
  });

  it('keeps Create disabled until there is a name and a positive value', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add quick discount/i }));
    const create = screen.getByRole('button', { name: 'Create Discount' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Student' } });
    fireEvent.change(screen.getByLabelText('Discount Value *'), { target: { value: '0' } });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Discount Value *'), { target: { value: '15' } });
    expect(create).not.toBeDisabled();
  });

  it('creates a quick discount with parsed caps and upper-cased code', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add quick discount/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Student' } });
    fireEvent.change(screen.getByLabelText('Internal Code'), { target: { value: 'stu' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'with ID' } });
    fireEvent.change(screen.getByLabelText('Discount Value *'), { target: { value: '7.5' } });
    fireEvent.change(screen.getByLabelText('Min Purchase ($)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Max Discount Cap ($)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Display Order'), { target: { value: '3' } });
    const [typeSelect, colorSelect] = within(dialog).getAllByRole('combobox');
    pick(typeSelect, 'Fixed Amount ($)');
    pick(colorSelect, 'Green');
    const [showInPos, approval, active] = within(dialog).getAllByRole('switch');
    fireEvent.click(showInPos);
    fireEvent.click(approval);
    fireEvent.click(active);
    fireEvent.click(screen.getByRole('button', { name: 'Create Discount' }));

    await waitFor(() => expect(m.types.create).toHaveBeenCalled());
    expect(m.types.create.mock.calls[0][0]).toMatchObject({
      name: 'Student', code: 'STU', description: 'with ID', discountType: 'fixed', discountValue: 7.5,
      minPurchase: 10, maxDiscount: 30, approvalThreshold: null, displayOrder: 3, color: 'green',
      showInPos: false, requiresApproval: true, isActive: false,
    });
    await waitFor(() => expect(lastToast()).toBe('Quick discount created successfully'));
  });

  it('edits an existing quick discount, pre-filling its values', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Senior' }));

    expect((screen.getByLabelText('Max Discount Cap ($)') as HTMLInputElement).value).toBe('25');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Seniors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(m.types.update).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'Seniors', maxDiscount: 25, approvalThreshold: 50 }))
    );
    await waitFor(() => expect(lastToast()).toBe('Quick discount updated successfully'));
  });

  it('pre-fills blanks for a discount with no caps or icon', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Military' }));

    expect((screen.getByLabelText('Max Discount Cap ($)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Internal Code') as HTMLInputElement).value).toBe('');
  });

  it('reports create, update and delete failures', async () => {
    m.types.create.mockRejectedValue(new Error('x'));
    m.types.update.mockRejectedValue(new Error('x'));
    m.types.remove.mockRejectedValue(new Error('x'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Senior' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to delete discount'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Senior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to update discount'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: /add quick discount/i }));
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'N' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Discount' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to create discount'));
  });

  it('deletes a quick discount', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Military' }));

    await waitFor(() => expect(m.types.remove).toHaveBeenCalledWith('t2'));
    await waitFor(() => expect(lastToast()).toBe('Quick discount deleted'));
  });
});

describe('AdminDiscounts promo codes', () => {
  it('labels each promo by status: active, inactive, expired, scheduled, exhausted', async () => {
    renderPage();
    await screen.findByText('Military');

    openTab(/promo codes/i);

    const statusOf = (code: string) => (screen.getByText(code).closest('tr') as HTMLElement).textContent;
    expect(statusOf('LIVE')).toContain('Active');
    expect(statusOf('LIVE')).toContain('3 / 100');
    expect(statusOf('LIVE')).toContain('Min: $20');
    expect(statusOf('OFF')).toContain('Inactive');
    expect(statusOf('OLD')).toContain('Expired');
    expect(statusOf('SOON')).toContain('Scheduled');
    expect(statusOf('SOON')).toContain('First order only');
    expect(statusOf('GONE')).toContain('Exhausted');
    expect(statusOf('OFF')).toContain('0 / ∞');
    expect(statusOf('OFF')).toContain('No expiry');
  });

  it('filters promos by code or name', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/promo codes/i);

    fireEvent.change(screen.getByPlaceholderText(/search discounts/i), { target: { value: 'used up' } });

    expect(screen.getByText('GONE')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/search discounts/i), { target: { value: 'zzz' } });
    expect(screen.getByText('No promo codes found')).toBeTruthy();
  });

  it('creates a promo code: strips spaces, upper-cases, parses limits and sends ISO dates', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/promo codes/i);
    fireEvent.click(screen.getByRole('button', { name: /create promo code/i }));
    const dialog = screen.getByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create Promo Code' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Promo Code *'), { target: { value: 'save 20' } });
    fireEvent.change(screen.getByLabelText('Display Name *'), { target: { value: 'Summer' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'hot' } });
    fireEvent.change(screen.getByLabelText('Discount Value *'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Min Purchase ($)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Max Discount Cap ($)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Start Date *'), { target: { value: '2030-01-01T09:00' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2030-02-01T09:00' } });
    fireEvent.change(screen.getByLabelText('Max Total Uses'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Uses Per Customer'), { target: { value: '2' } });
    pick(within(dialog).getByRole('combobox'), 'Free Shipping');
    const [firstOrder, stackable] = within(dialog).getAllByRole('switch');
    fireEvent.click(firstOrder);
    fireEvent.click(stackable);
    fireEvent.click(create);

    await waitFor(() => expect(m.promos.create).toHaveBeenCalled());
    expect(m.promos.create.mock.calls[0][0]).toMatchObject({
      code: 'SAVE20', name: 'Summer', description: 'hot', discountType: 'free_shipping', discountValue: 20,
      minPurchase: 50, maxDiscount: 40, maxUses: 10, maxUsesPerCustomer: 2, firstOrderOnly: true, stackable: true,
      startsAt: new Date('2030-01-01T09:00').toISOString(),
      expiresAt: new Date('2030-02-01T09:00').toISOString(),
    });
    await waitFor(() => expect(lastToast()).toBe('Promo code created successfully'));
  });

  it('sends null limits and expiry when left blank', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/promo codes/i);
    fireEvent.click(screen.getByRole('button', { name: /create promo code/i }));

    fireEvent.change(screen.getByLabelText('Promo Code *'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Display Name *'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Promo Code' }));

    await waitFor(() =>
      expect(m.promos.create).toHaveBeenCalledWith(expect.objectContaining({ maxDiscount: null, maxUses: null, expiresAt: null }))
    );
  });

  it('round-trips promo dates in local time west of UTC', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const startsAt = Date.UTC(2030, 0, 15, 3, 30); // 22:30 on Jan 14 in New York
      const expiresAt = Date.UTC(2030, 0, 20, 15, 0);
      m.promos.list.mockResolvedValue([promo({ id: 'tz', code: 'TZ', startsAt, expiresAt })]);
      renderPage();
      await screen.findByText('Military');
      openTab(/promo codes/i);

      fireEvent.click(await screen.findByRole('button', { name: 'Edit TZ' }));
      expect((screen.getByLabelText('Start Date *') as HTMLInputElement).value).toBe('2030-01-14T22:30');
      expect((screen.getByLabelText('End Date') as HTMLInputElement).value).toBe('2030-01-20T10:00');
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(m.promos.update).toHaveBeenCalled());
      expect(m.promos.update.mock.calls[0][1]).toMatchObject({
        startsAt: new Date(startsAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      });
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it('counts only currently active promos in the summary card', async () => {
    renderPage();
    await screen.findByText('Military');

    // PROMOS has one live code; the inactive, expired, scheduled and exhausted ones do not count.
    expect(screen.getByText('Active Promo Codes').parentElement?.parentElement?.textContent).toBe('Active Promo Codes1');
  });

  it('edits a promo and deletes another', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/promo codes/i);

    fireEvent.click(screen.getByRole('button', { name: 'Edit LIVE' }));
    expect((screen.getByLabelText('Max Total Uses') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('End Date') as HTMLInputElement).value).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(m.promos.update).toHaveBeenCalledWith('p1', expect.objectContaining({ code: 'LIVE', maxUses: 100 })));
    await waitFor(() => expect(lastToast()).toBe('Promo code updated successfully'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit OFF' }));
    expect((screen.getByLabelText('End Date') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete OLD' }));
    await waitFor(() => expect(m.promos.remove).toHaveBeenCalledWith('p3'));
    await waitFor(() => expect(lastToast()).toBe('Promo code deleted'));
  });

  it('reports promo failures', async () => {
    m.promos.create.mockRejectedValue(new Error('dup'));
    m.promos.update.mockRejectedValue(new Error('x'));
    m.promos.remove.mockRejectedValue(new Error('x'));
    renderPage();
    await screen.findByText('Military');
    openTab(/promo codes/i);

    fireEvent.click(screen.getByRole('button', { name: 'Delete OLD' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to delete promo code'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit LIVE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to update promo code'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: /create promo code/i }));
    fireEvent.change(screen.getByLabelText('Promo Code *'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Display Name *'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Promo Code' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to create promo code'));
  });
});

describe('AdminDiscounts employee discounts', () => {
  it('lists employee entitlements with caps and approval thresholds', async () => {
    renderPage();
    await screen.findByText('Military');

    openTab(/employee discounts/i);

    const pat = (screen.getByText('Pat').closest('tr') as HTMLElement).textContent;
    expect(pat).toContain('20%');
    expect(pat).toContain('$100');
    expect(pat).toContain('$12.50');
    expect(pat).toContain('Above $40');
    const sam = (screen.getByText('Sam').closest('tr') as HTMLElement).textContent;
    expect(sam).toContain('Unlimited');
    expect(sam).toContain('Inactive');
  });

  it('adds a discount for a chosen employee', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/employee discounts/i);
    fireEvent.click(screen.getByRole('button', { name: /add employee discount/i }));
    const dialog = screen.getByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add Discount' });
    expect(add).toBeDisabled();

    await waitFor(() => expect(m.users.list).toHaveBeenCalled());
    pick(within(dialog).getByRole('combobox'), 'Lee (lee@x.test)');
    fireEvent.change(screen.getByLabelText('Discount Percentage *'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Monthly Cap ($)'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/require manager approval above/i), { target: { value: '75' } });
    fireEvent.click(within(dialog).getByRole('switch'));
    fireEvent.click(add);

    await waitFor(() =>
      expect(m.employee.upsert).toHaveBeenCalledWith({
        userId: 'u9', discountPercentage: 15, maxDiscountAmount: 200, requiresManagerApprovalAbove: 75, isActive: false,
      })
    );
    await waitFor(() => expect(lastToast()).toBe('Employee discount saved successfully'));
  });

  it('edits with the employee locked and blank caps sent as null', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/employee discounts/i);
    const samRow = screen.getByText('Sam').closest('tr') as HTMLElement;

    fireEvent.click(within(samRow).getByRole('button', { name: 'Edit employee discount' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(m.employee.upsert).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u2', maxDiscountAmount: null, requiresManagerApprovalAbove: null,
      }))
    );
  });

  it('removes an employee discount and reports failures', async () => {
    renderPage();
    await screen.findByText('Military');
    openTab(/employee discounts/i);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove employee discount' });

    fireEvent.click(removeButtons[0]);
    await waitFor(() => expect(m.employee.remove).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(lastToast()).toBe('Employee discount removed'));

    m.employee.remove.mockRejectedValue(new Error('x'));
    fireEvent.click(removeButtons[1]);
    await waitFor(() => expect(lastToast()).toBe('Failed to remove employee discount'));

    m.employee.upsert.mockRejectedValue(new Error('x'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit employee discount' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(lastToast()).toBe('Failed to save employee discount'));
  });

  it('says so when no employee discounts exist', async () => {
    m.employee.list.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Military');

    openTab(/employee discounts/i);

    expect(await screen.findByText('No employee discounts configured')).toBeTruthy();
  });
});
