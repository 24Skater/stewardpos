import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import AdminInventory from '../admin/AdminInventory';

const m = vi.hoisted(() => ({
  products: {
    list: vi.fn(),
    lowStock: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    variants: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
  categories: { listWithUnmanaged: vi.fn(), create: vi.fn() },
  admin: { resetDatabase: vi.fn() },
  upload: { upload: vi.fn() },
  exportCsv: vi.fn(),
  session: { current: null as unknown },
  toasts: [] as { title?: string; description?: string }[],
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  productsApi: m.products,
  categoriesApi: m.categories,
  adminApi: m.admin,
  uploadApi: m.upload,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentSession: vi.fn(async () => m.session.current),
}));

vi.mock('@/lib/export-utils', () => ({ exportInventoryToCSV: m.exportCsv }));

vi.mock('@/hooks/use-toast', () => {
  const toast = (t: { title?: string; description?: string }) => m.toasts.push(t);
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

vi.mock('@/components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ADMIN = {
  user: { id: 'u1', email: 'a@x.test', name: 'A', roleIds: ['r1'], roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }] },
  permissions: {},
};

const TEA = {
  id: 'p1', name: 'Green Tea', description: 'leaf', category: 'Drinks', basePrice: 4.5, image: 'https://img/tea.png', barcode: '123',
  variants: [
    { id: 'v1', size: 'S', color: '', priceDelta: 0, stock: 2, enabled: true },
    { id: 'v2', size: 'L', color: '', priceDelta: 1, stock: 3, enabled: false },
  ],
  createdAt: 0, updatedAt: 0,
};
const MUG = {
  id: 'p2', name: 'Mug', category: 'Legacy', basePrice: 10, variants: [{ id: 'v3', priceDelta: 0, stock: 40, enabled: true }],
  createdAt: 0, updatedAt: 0,
};

const lastToast = () => m.toasts.at(-1);
const renderPage = () => render(<MemoryRouter><AdminInventory /></MemoryRouter>);

async function openAdd() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /add product/i }));
  return screen.getByRole('dialog');
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  m.toasts.length = 0;
  m.session.current = ADMIN;
  m.products.list.mockResolvedValue([TEA, MUG]);
  m.products.lowStock.mockResolvedValue([{ productId: 'p1' }]);
  m.categories.listWithUnmanaged.mockResolvedValue({ data: [{ id: 'c1', name: 'Drinks' }], meta: { unmanaged: [{ name: 'Snacks' }] } });
  for (const fn of [m.products.create, m.products.update, m.products.remove, m.products.variants.create,
    m.products.variants.update, m.products.variants.remove, m.categories.create, m.admin.resetDatabase]) fn.mockResolvedValue({});
  m.upload.upload.mockResolvedValue({ url: 'https://cdn/new.png' });
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => confirmSpy.mockRestore());

describe('AdminInventory list', () => {
  it('shows totals, active variant counts and the server-judged low-stock badge', async () => {
    renderPage();

    const tea = (await screen.findByText('Green Tea')).closest('tr') as HTMLElement;
    expect(tea.textContent).toContain('$4.50');
    expect(tea.textContent).toContain('1 active');
    expect(tea.textContent).toContain('5');
    expect(within(tea).getByText('Low Stock')).toBeTruthy();
    const mug = screen.getByText('Mug').closest('tr') as HTMLElement;
    expect(within(mug).getByText('In Stock')).toBeTruthy();
  });

  it('filters by product name or category', async () => {
    renderPage();
    await screen.findByText('Green Tea');

    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: 'legacy' } });

    expect(screen.queryByText('Green Tea')).toBeNull();
    expect(screen.getByText('Mug')).toBeTruthy();
  });

  it('reports a failed load', async () => {
    m.products.list.mockRejectedValue(new Error('offline'));

    renderPage();

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Error', description: 'offline' }));
  });

  it('hides write controls from a signed-out viewer but still allows export', async () => {
    m.session.current = null;
    renderPage();
    await screen.findByText('Green Tea');

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(m.exportCsv).toHaveBeenCalledWith([TEA, MUG]);
    expect(screen.queryByRole('button', { name: /add product/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Mug' })).toBeNull();
  });

  it('opens the import dialog', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    expect(await screen.findByText('Import Inventory')).toBeTruthy();
  });
});

describe('AdminInventory reset and delete', () => {
  it('does nothing when the reset warning is declined', async () => {
    confirmSpy.mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /reset demo data/i }));

    expect(confirmSpy.mock.calls[0][0]).toMatch(/permanently deletes ALL orders/);
    expect(m.admin.resetDatabase).not.toHaveBeenCalled();
  });

  it('resets and reloads when confirmed, and reports a refusal', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /reset demo data/i }));
    await waitFor(() => expect(lastToast()?.title).toBe('Database Reset'));
    expect(m.products.list).toHaveBeenCalledTimes(2);

    m.admin.resetDatabase.mockRejectedValue(new Error('refused in production'));
    fireEvent.click(screen.getByRole('button', { name: /reset demo data/i }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'refused in production' }));
  });

  it('deletes a product only after confirmation and reports failures', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Mug' }));
    await waitFor(() => expect(lastToast()?.title).toBe('Product deleted'));
    expect(m.products.remove).toHaveBeenCalledWith('p2');

    m.products.remove.mockRejectedValue(new Error('has sales'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mug' }));
    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'has sales' }));

    confirmSpy.mockReturnValue(false);
    m.products.remove.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mug' }));
    expect(m.products.remove).not.toHaveBeenCalled();
  });
});

describe('AdminInventory create', () => {
  it('requires a product name', async () => {
    await openAdd();

    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

    expect(lastToast()).toMatchObject({ description: 'Product name is required' });
    expect(m.products.create).not.toHaveBeenCalled();
  });

  it('creates a product with variants (no temp ids) and defaults the category', async () => {
    const dialog = await openAdd();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scone' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'fresh' } });
    fireEvent.change(screen.getByLabelText('Base Price'), { target: { value: '3.25' } });
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '777' } });
    fireEvent.change(within(dialog).getByPlaceholderText('S, M…'), { target: { value: 'Big' } });
    fireEvent.change(within(dialog).getByPlaceholderText('Red…'), { target: { value: 'Brown' } });
    const [, priceDelta, stock] = within(dialog).getAllByRole('spinbutton');
    fireEvent.change(priceDelta, { target: { value: '0.5' } });
    fireEvent.change(stock, { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Variant 1 active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

    await waitFor(() => expect(m.products.create).toHaveBeenCalled());
    expect(m.products.create).toHaveBeenCalledWith({
      name: 'Scone', description: 'fresh', category: 'Uncategorized', basePrice: 3.25, barcode: '777', image: '',
      variants: [{ size: 'Big', color: 'Brown', priceDelta: 0.5, stock: 12, enabled: false }],
    });
    await waitFor(() => expect(lastToast()?.title).toBe('Product added successfully'));
  });

  it('adds and removes variant rows but never below one', async () => {
    const dialog = await openAdd();
    expect(within(dialog).getByRole('button', { name: 'Remove variant 1' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /add variant/i }));
    expect(within(dialog).getAllByPlaceholderText('S, M…')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove variant 2' }));

    expect(within(dialog).getAllByPlaceholderText('S, M…')).toHaveLength(1);
  });

  it('picks a category from managed and unmanaged names', async () => {
    const dialog = await openAdd();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chips' } });

    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByRole('option', { name: 'Drinks' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Snacks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

    await waitFor(() => expect(m.products.create).toHaveBeenCalledWith(expect.objectContaining({ category: 'Snacks' })));
  });

  it('creates a new managed category and selects it', async () => {
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole('button', { name: /^new$/i }));
    const input = within(dialog).getByPlaceholderText('New category name');
    expect(within(dialog).getByRole('button', { name: /^add$/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: '  Bakery ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(lastToast()?.title).toBe('Category "Bakery" created'));
    expect(m.categories.create).toHaveBeenCalledWith({ name: 'Bakery' });
    expect(within(dialog).getByRole('combobox').textContent).toContain('Bakery');
  });

  it('reports a failed category create and can cancel back to the picker', async () => {
    m.categories.create.mockRejectedValue(new Error('exists'));
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole('button', { name: /^new$/i }));
    fireEvent.change(within(dialog).getByPlaceholderText('New category name'), { target: { value: 'Drinks' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'exists' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel new category' }));

    expect(within(dialog).getByRole('combobox')).toBeTruthy();
  });

  it('reports a failed create', async () => {
    m.products.create.mockRejectedValue(new Error('duplicate barcode'));
    await openAdd();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'duplicate barcode' }));
  });

  it('closes on Cancel without saving', async () => {
    await openAdd();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.products.create).not.toHaveBeenCalled();
  });
});

describe('AdminInventory image upload', () => {
  const fileInput = (dialog: HTMLElement) => dialog.querySelector('input[type="file"]') as HTMLInputElement;
  const choose = (dialog: HTMLElement, file: File) => fireEvent.change(fileInput(dialog), { target: { files: [file] } });

  it('rejects files over 5MB and non-images before uploading', async () => {
    const dialog = await openAdd();

    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    choose(dialog, big);
    expect(lastToast()).toMatchObject({ description: 'Image must be less than 5MB' });

    choose(dialog, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    expect(lastToast()).toMatchObject({ description: 'Please upload an image file' });
    expect(m.upload.upload).not.toHaveBeenCalled();
  });

  it('uploads an image, previews it, and saves its URL', async () => {
    const dialog = await openAdd();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pic' } });

    choose(dialog, new File(['x'], 'a.png', { type: 'image/png' }));

    await waitFor(() => expect(lastToast()?.title).toBe('Image uploaded'));
    expect((within(dialog).getByAltText('Preview') as HTMLImageElement).src).toBe('https://cdn/new.png');
    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
    await waitFor(() => expect(m.products.create).toHaveBeenCalledWith(expect.objectContaining({ image: 'https://cdn/new.png' })));
  });

  it('says so when the upload fails', async () => {
    m.upload.upload.mockRejectedValue(new Error('too slow'));
    const dialog = await openAdd();

    choose(dialog, new File(['x'], 'a.png', { type: 'image/png' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Upload failed', description: 'too slow' }));
    expect(within(dialog).queryByAltText('Preview')).toBeNull();
  });

  it('accepts an image URL typed into the URL tab', async () => {
    const dialog = await openAdd();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pic' } });
    const tab = within(dialog).getByRole('tab', { name: 'Image URL' });
    fireEvent.mouseDown(tab);

    fireEvent.change(await within(dialog).findByPlaceholderText('https://example.com/image.jpg'), { target: { value: 'https://x/y.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

    await waitFor(() => expect(m.products.create).toHaveBeenCalledWith(expect.objectContaining({ image: 'https://x/y.png' })));
  });
});

describe('AdminInventory edit', () => {
  it('saves product fields and syncs only the changed variants', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Green Tea' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox').textContent).toContain('Drinks');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sencha' } });
    const stocks = within(dialog).getAllByRole('spinbutton').filter((_, i) => i === 2 || i === 4);
    fireEvent.change(stocks[0], { target: { value: '9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove variant 2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /add variant/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(lastToast()?.title).toBe('Product updated'));
    expect(m.products.update).toHaveBeenCalledWith('p1', {
      name: 'Sencha', description: 'leaf', category: 'Drinks', basePrice: 4.5, barcode: '123', image: 'https://img/tea.png',
    });
    expect(m.products.variants.update).toHaveBeenCalledWith('p1', 'v1', expect.objectContaining({ stock: 9 }));
    expect(m.products.variants.remove).toHaveBeenCalledWith('p1', 'v2');
    expect(m.products.variants.create).toHaveBeenCalledTimes(1);
  });

  it('sends a base price of 0 (not NaN) when the edited base price is cleared', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Green Tea' }));

    fireEvent.change(screen.getByLabelText('Base Price'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(lastToast()?.title).toBe('Product updated'));
    expect(m.products.update).toHaveBeenCalledWith('p1', expect.objectContaining({ basePrice: 0 }));
  });

  it('keeps an out-of-list category visible when editing', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Mug' }));

    expect(within(screen.getByRole('dialog')).getByRole('combobox').textContent).toContain('Legacy');
  });

  it('reports a failed update', async () => {
    m.products.update.mockRejectedValue(new Error('stale'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Mug' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'stale' }));
  });
});
