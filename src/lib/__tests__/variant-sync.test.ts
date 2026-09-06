import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductVariant } from '../api';
import { diffVariants, hasVariantChanges, applyVariantChanges } from '../variant-sync';

/**
 * Turning an edited variant list back into API calls.
 *
 * The product-update endpoint does not touch variants, so both inventory
 * screens' "Save" used to drop every change to the variant table — a corrected
 * stock count, a disabled size, a new colour — without a word. `diffVariants`
 * is what decides which sub-resource calls that edit actually needs.
 */

const variant = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  id: over.id ?? 'v1',
  size: over.size,
  color: over.color,
  priceOverride: over.priceOverride,
  priceDelta: over.priceDelta ?? 0,
  sku: over.sku,
  barcode: over.barcode,
  stock: over.stock ?? 0,
  enabled: over.enabled ?? true,
  lowStockThreshold: over.lowStockThreshold,
});

describe('diffVariants', () => {
  it('finds nothing to send when nothing changed', () => {
    const original = [variant({ id: 'v1', stock: 5 })];
    const diff = diffVariants(original, [{ ...original[0] }]);

    expect(diff).toEqual({ toCreate: [], toUpdate: [], toRemove: [] });
    expect(hasVariantChanges(diff)).toBe(false);
  });

  it('sends only the fields that moved on an existing variant', () => {
    const original = [variant({ id: 'v1', stock: 5, size: 'M', enabled: true })];

    const diff = diffVariants(original, [{ ...original[0], stock: 20 }]);

    expect(diff.toUpdate).toEqual([{ id: 'v1', changes: { stock: 20 } }]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });

  it('treats disabling a variant as a change', () => {
    const original = [variant({ id: 'v1', enabled: true }), variant({ id: 'v2' })];

    const diff = diffVariants(original, [
      { ...original[0], enabled: false },
      { ...original[1] },
    ]);

    expect(diff.toUpdate).toEqual([{ id: 'v1', changes: { enabled: false } }]);
  });

  it('creates a row that has no server id', () => {
    const original = [variant({ id: 'v1' })];

    const diff = diffVariants(original, [
      { ...original[0] },
      { id: 'tmp-123', size: 'L', stock: 8, enabled: true },
    ]);

    expect(diff.toCreate).toEqual([{ size: 'L', stock: 8, enabled: true }]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });

  it('removes a loaded variant that is no longer in the list', () => {
    const original = [variant({ id: 'v1' }), variant({ id: 'v2' })];

    const diff = diffVariants(original, [{ ...original[0] }]);

    expect(diff.toRemove).toEqual(['v2']);
  });

  it('does not remove the last remaining variant', () => {
    // A product with no variants cannot be sold and the server rejects the
    // delete; dropping it here keeps Save from failing on a call it should
    // never have made.
    const original = [variant({ id: 'v1' })];

    const diff = diffVariants(original, []);

    expect(diff.toRemove).toEqual([]);
  });

  it('still clears old variants when new ones replace them', () => {
    const original = [variant({ id: 'v1' }), variant({ id: 'v2' })];

    const diff = diffVariants(original, [
      { id: 'tmp-9', size: 'XL', stock: 3, enabled: true },
    ]);

    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toRemove.sort()).toEqual(['v1', 'v2']);
  });

  it('treats an empty string and an unset field as the same', () => {
    const original = [variant({ id: 'v1', sku: undefined })];

    const diff = diffVariants(original, [{ ...original[0], sku: '' }]);

    expect(diff.toUpdate).toEqual([]);
  });
});

vi.mock('../api', () => ({
  productsApi: {
    variants: {
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe('applyVariantChanges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates and updates before it removes', async () => {
    const { productsApi } = await import('../api');
    const calls: string[] = [];
    (productsApi.variants.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('create');
    });
    (productsApi.variants.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('update');
    });
    (productsApi.variants.remove as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('remove');
    });

    await applyVariantChanges('p1', {
      toCreate: [{ stock: 1, enabled: true }],
      toUpdate: [{ id: 'v1', changes: { stock: 2 } }],
      toRemove: ['v2'],
    });

    expect(calls).toEqual(['create', 'update', 'remove']);
    expect(productsApi.variants.create).toHaveBeenCalledWith('p1', { stock: 1, enabled: true });
    expect(productsApi.variants.update).toHaveBeenCalledWith('p1', 'v1', { stock: 2 });
    expect(productsApi.variants.remove).toHaveBeenCalledWith('p1', 'v2');
  });

  it('makes no calls for an empty diff', async () => {
    const { productsApi } = await import('../api');

    await applyVariantChanges('p1', { toCreate: [], toUpdate: [], toRemove: [] });

    expect(productsApi.variants.create).not.toHaveBeenCalled();
    expect(productsApi.variants.update).not.toHaveBeenCalled();
    expect(productsApi.variants.remove).not.toHaveBeenCalled();
  });
});
