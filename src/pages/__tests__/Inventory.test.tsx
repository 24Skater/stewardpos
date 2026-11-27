import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Inventory from '../Inventory';

const m = vi.hoisted(() => ({
  products: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    variants: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
  toasts: [] as { title?: string; description?: string }[],
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  productsApi: m.products,
}));

vi.mock('@/hooks/use-toast', () => {
  const toast = (t: { title?: string; description?: string }) => m.toasts.push(t);
  return { useToast: () => ({ toast, dismiss: () => {} }), toast };
});

const SHIRT = {
  id: 'p1', name: 'Shirt', category: 'Apparel', basePrice: 20, barcode: 'B1',
  variants: [
    { id: 'v1', size: 'M', color: 'Red', priceDelta: 0, stock: 4, enabled: true },
    { id: 'v2', size: 'L', color: 'Red', priceDelta: 2, stock: 1, enabled: true },
  ],
  createdAt: 0, updatedAt: 0,
};
const EMPTY = { id: 'p2', name: 'Cap', category: 'Hats', basePrice: 9, variants: [{ id: 'v3', priceDelta: 0, stock: 0, enabled: true }], createdAt: 0, updatedAt: 0 };

const lastToast = () => m.toasts.at(-1);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inventory']}>
        <Routes>
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/" element={<p>register home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  m.toasts.length = 0;
  m.products.list.mockResolvedValue([SHIRT, EMPTY]);
  for (const fn of [m.products.create, m.products.update, m.products.remove,
    m.products.variants.create, m.products.variants.update, m.products.variants.remove]) fn.mockResolvedValue({});
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => confirmSpy.mockRestore());

describe('Inventory list', () => {
  it('shows each product with variant count and summed stock', async () => {
    renderPage();

    const shirt = await rowOf('Shirt');
    expect(shirt.textContent).toContain('$20.00');
    expect(shirt.textContent).toContain('2');
    expect(shirt.textContent).toContain('5');
    expect(screen.getByText('2 products')).toBeTruthy();
  });

  it('says there are no products yet', async () => {
    m.products.list.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('No products yet')).toBeTruthy();
  });

  it('shows the load error and retries on request', async () => {
    m.products.list.mockRejectedValueOnce(new Error('catalog down'));
    renderPage();

    expect(await screen.findByText('catalog down')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Shirt')).toBeTruthy();
  });

  it('goes back to the register', async () => {
    renderPage();
    await screen.findByText('Shirt');

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(await screen.findByText('register home')).toBeTruthy();
  });
});

describe('Inventory create', () => {
  it('requires a product name', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));

    expect(lastToast()).toMatchObject({ description: 'Product name is required' });
  });

  it('creates a product with the typed fields and variants, without client ids', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Socks' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Feet' } });
    fireEvent.change(screen.getByLabelText('Base Price'), { target: { value: '6.5' } });
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: 'S1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /add variant/i }));
    const sizes = within(dialog).getAllByPlaceholderText('S, M, L...');
    fireEvent.change(sizes[1], { target: { value: 'XL' } });
    fireEvent.change(within(dialog).getAllByPlaceholderText('Red, Blue...')[1], { target: { value: 'Blue' } });
    const numbers = within(dialog).getAllByRole('spinbutton');
    fireEvent.change(numbers[3], { target: { value: '1.25' } });
    fireEvent.change(numbers[4], { target: { value: '8' } });
    fireEvent.click(within(dialog).getAllByRole('switch', { name: 'Variant active' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));

    await waitFor(() => expect(m.products.create).toHaveBeenCalled());
    const body = m.products.create.mock.calls[0][0];
    expect(body).toMatchObject({ name: 'Socks', category: 'Feet', basePrice: 6.5, barcode: 'S1' });
    expect(body.variants).toEqual([
      expect.objectContaining({ priceDelta: 0, stock: 0, enabled: false }),
      expect.objectContaining({ size: 'XL', color: 'Blue', priceDelta: 1.25, stock: 8, enabled: true }),
    ]);
    expect(body.variants[0]).not.toHaveProperty('id');
    await waitFor(() => expect(lastToast()?.title).toBe('Product added successfully'));
  });

  it('removes an added variant but never the last one', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));
    const dialog = screen.getByRole('dialog');
    const removeButtons = () =>
      within(dialog).getAllByRole('button').filter((b) => b.className.includes('hover:text-destructive'));
    expect(removeButtons()[0]).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /add variant/i }));
    fireEvent.click(removeButtons()[1]);

    expect(within(dialog).getAllByPlaceholderText('S, M, L...')).toHaveLength(1);
  });

  it('reports a failed create and keeps the dialog open', async () => {
    m.products.create.mockRejectedValue(new Error('bad price'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));

    fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'bad price' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Cancel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Inventory edit and delete', () => {
  it('updates the product and persists the variant stock change', async () => {
    renderPage();
    const [edit] = within(await rowOf('Shirt')).getAllByRole('button');
    fireEvent.click(edit);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit Product')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Tee' } });
    fireEvent.change(within(dialog).getAllByRole('spinbutton')[2], { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));

    await waitFor(() => expect(lastToast()?.title).toBe('Product updated successfully'));
    expect(m.products.update).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Tee', barcode: 'B1' }));
    expect(m.products.variants.update).toHaveBeenCalledWith('p1', 'v1', expect.objectContaining({ stock: 10 }));
    expect(m.products.create).not.toHaveBeenCalled();
  });

  it('reports a failed update', async () => {
    m.products.update.mockRejectedValue(new Error('conflict'));
    renderPage();
    fireEvent.click(within(await rowOf('Shirt')).getAllByRole('button')[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'conflict' }));
  });

  it('deletes only after confirmation and reports failures', async () => {
    renderPage();
    const del = within(await rowOf('Cap')).getAllByRole('button')[1];

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(del);
    expect(m.products.remove).not.toHaveBeenCalled();

    fireEvent.click(del);
    await waitFor(() => expect(lastToast()?.title).toBe('Product deleted'));
    expect(m.products.remove.mock.calls[0][0]).toBe('p2');

    m.products.remove.mockRejectedValue(new Error('in use'));
    fireEvent.click(within(await rowOf('Cap')).getAllByRole('button')[1]);
    await waitFor(() => expect(lastToast()).toMatchObject({ description: 'in use' }));
  });

  it('keeps the "New Product" title while a new product is being named', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add product/i }));

    fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'S' } });

    expect(within(screen.getByRole('dialog')).getByText('New Product')).toBeTruthy();
  });
});
