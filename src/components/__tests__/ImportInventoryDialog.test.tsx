import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImportInventoryDialog from '../ImportInventoryDialog';

const m = vi.hoisted(() => ({
  products: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    variants: { create: vi.fn(), update: vi.fn() },
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

const HEADER =
  'Product ID,Product Name,Category,Base Price,Variant ID,Size,Color,Price Delta,Price Override,SKU,Barcode,Stock,Enabled';

const EXISTING = {
  id: 'p1',
  name: 'Old Tee',
  category: 'Tees',
  basePrice: 20,
  variants: [
    { id: 'v-sku', sku: 'TEE-M', size: 'M', color: 'Black', stock: 1, enabled: true },
    { id: 'v-bar', barcode: '999', size: 'L', color: 'Black', stock: 1, enabled: true },
    { id: 'v-pair', size: 'XL', color: 'Red', stock: 1, enabled: true },
  ],
};

const lastToast = () => m.toasts.at(-1);

function setup() {
  const onOpenChange = vi.fn();
  const onImportComplete = vi.fn();
  render(<ImportInventoryDialog open onOpenChange={onOpenChange} onImportComplete={onImportComplete} />);
  return { onOpenChange, onImportComplete };
}

function upload(text: string, name = 'inventory.csv') {
  const input = document.getElementById('file-upload') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.toasts.length = 0;
  m.products.list.mockResolvedValue([EXISTING]);
  m.products.create.mockResolvedValue({});
  m.products.update.mockResolvedValue({});
  m.products.variants.create.mockResolvedValue({});
  m.products.variants.update.mockResolvedValue({});
});

describe('ImportInventoryDialog', () => {
  it('rejects a file that is not a CSV', async () => {
    setup();

    upload('anything', 'inventory.xlsx');

    expect(lastToast()).toMatchObject({ title: 'Invalid file type' });
    expect(m.products.list).not.toHaveBeenCalled();
  });

  it('groups rows by Product ID into one new product with parsed variants', async () => {
    const { onOpenChange, onImportComplete } = setup();
    const csv = [
      HEADER,
      'new-1,Hoodie,Sweats,40.00,x,M,Grey,0,,HD-M,111,10,Yes',
      'new-1,Hoodie,Sweats,40.00,x,L,Grey,2.5,45,HD-L,,abc,no',
      ',Orphan,Nope,1,x,,,,,,,,',
      '',
    ].join('\r\n');

    upload(csv);

    await waitFor(() => expect(m.products.create).toHaveBeenCalledTimes(1));
    expect(m.products.create).toHaveBeenCalledWith({
      name: 'Hoodie',
      category: 'Sweats',
      basePrice: 40,
      variants: [
        { size: 'M', color: 'Grey', priceDelta: 0, priceOverride: undefined, sku: 'HD-M', barcode: '111', stock: 10, enabled: true },
        { size: 'L', color: 'Grey', priceDelta: 2.5, priceOverride: 45, sku: 'HD-L', barcode: undefined, stock: 0, enabled: false },
      ],
    });
    await waitFor(() => expect(onImportComplete).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(lastToast()).toMatchObject({ title: 'Import successful', description: '1 products imported, 0 updated' });
  });

  it('updates an existing product and matches variants by SKU, then barcode, then size/colour', async () => {
    setup();
    const csv = [
      HEADER,
      'p1,New Tee,Shirts,22,x,M,Black,0,,TEE-M,,5,Yes',
      'p1,New Tee,Shirts,22,x,L,Black,0,,,999,6,Yes',
      'p1,New Tee,Shirts,22,x,XL,Red,0,,,,7,Yes',
      'p1,New Tee,Shirts,22,x,S,Blue,0,,,,8,Yes',
    ].join('\n');

    upload(csv);

    await waitFor(() => expect(lastToast()?.title).toBe('Import successful'));
    expect(m.products.update).toHaveBeenCalledWith('p1', { name: 'New Tee', category: 'Shirts', basePrice: 22 });
    expect(m.products.variants.update).toHaveBeenCalledWith('p1', 'v-sku', expect.objectContaining({ stock: 5 }));
    expect(m.products.variants.update).toHaveBeenCalledWith('p1', 'v-bar', expect.objectContaining({ stock: 6 }));
    expect(m.products.variants.update).toHaveBeenCalledWith('p1', 'v-pair', expect.objectContaining({ stock: 7 }));
    expect(m.products.variants.create).toHaveBeenCalledWith('p1', expect.objectContaining({ size: 'S', color: 'Blue' }));
    expect(m.products.create).not.toHaveBeenCalled();
    expect(lastToast()?.description).toBe('0 products imported, 1 updated, 4 variants applied');
  });

  it('reports the server error when the import fails and keeps the dialog open', async () => {
    m.products.list.mockRejectedValue(new Error('catalog unavailable'));
    const { onOpenChange, onImportComplete } = setup();

    upload(`${HEADER}\nn,A,B,1,x,,,,,,,1,Yes`);

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Import failed', description: 'catalog unavailable' }));
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('accepts a file dropped onto the upload area', async () => {
    setup();
    const zone = screen.getByText(/drag & drop/i).parentElement as HTMLElement;
    const file = new File([`${HEADER}\nn,A,B,1,x,,,,,,,1,Yes`], 'drop.csv');

    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(m.products.create).toHaveBeenCalled());
  });

  it('downloads a template', () => {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:t', configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setup();

    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    expect(click).toHaveBeenCalled();
    expect(lastToast()?.title).toBe('Template downloaded');
    click.mockRestore();
  });

  it('re-imports a quoted product name that contains a comma', async () => {
    setup();

    upload(`${HEADER}\nn,"Tea, Green",Drinks,5,x,,,0,,,,3,Yes`);

    await waitFor(() => expect(m.products.create).toHaveBeenCalled());
    expect(m.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tea, Green', category: 'Drinks', basePrice: 5 })
    );
  });

  it('matches a size-less variant when re-importing its own export', async () => {
    m.products.list.mockResolvedValue([
      { id: 'p9', name: 'Mug', category: 'Kitchen', basePrice: 8, variants: [{ id: 'v9', stock: 1, enabled: true }] },
    ]);
    setup();

    upload(`${HEADER}\np9,Mug,Kitchen,8,v9,N/A,N/A,0,,,,4,Yes`);

    await waitFor(() => expect(lastToast()?.title).toBe('Import successful'));
    expect(m.products.variants.create).not.toHaveBeenCalled();
    expect(m.products.variants.update).toHaveBeenCalledWith('p9', 'v9', expect.objectContaining({ stock: 4 }));
  });

  it('accepts an uppercase .CSV extension', async () => {
    setup();

    upload(`${HEADER}
n,A,B,1,x,,,,,,,1,Yes`, 'INVENTORY.CSV');

    await waitFor(() => expect(m.products.create).toHaveBeenCalled());
  });
});
