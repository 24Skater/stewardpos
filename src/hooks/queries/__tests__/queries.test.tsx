import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../keys';

/**
 * The query layer.
 *
 * Two things here are load-bearing and easy to break silently. The keys are
 * **hierarchical**, so invalidating `products.all` also clears every individual
 * product — TanStack matches on prefix, and a key that does not start with its
 * parent quietly stops being invalidated, leaving a cashier looking at a price
 * that changed minutes ago.
 *
 * And `enabled` gating: a detail hook called before its id exists must not fire,
 * or the app requests `/api/products/undefined` on every mount.
 */
vi.mock('@/lib/api', () => ({
  productsApi: {
    list: vi.fn(() => Promise.resolve([{ id: 'p1', name: 'Tea' }])),
    get: vi.fn((id: string) => Promise.resolve({ id, name: 'Tea' })),
    create: vi.fn(() => Promise.resolve({ id: 'p2' })),
    update: vi.fn(() => Promise.resolve({ id: 'p1' })),
    remove: vi.fn(() => Promise.resolve(undefined)),
  },
  ordersApi: {
    list: vi.fn(() => Promise.resolve([{ id: 'o1' }])),
    get: vi.fn((id: string) => Promise.resolve({ id })),
    byCustomerEmail: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve({ id: 'o2' })),
  },
  settingsApi: { get: vi.fn(() => Promise.resolve({})) },
  adminApi: { getSettings: vi.fn(() => Promise.resolve({})) },
}));

const { productsApi } = await import('@/lib/api');
const { useProducts, useProduct, useCreateProduct } = await import('../useProducts');

/** A fresh client per test, with retries off so a failure surfaces immediately. */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('query keys', () => {
  it('nests a detail key under its collection', () => {
    // Prefix matching is what makes `invalidateQueries({ queryKey: all })` clear
    // the individual entries too. A detail key that did not start with the
    // collection key would silently stop being invalidated.
    expect(queryKeys.products.detail('p1').slice(0, 1)).toEqual(queryKeys.products.all);
    expect(queryKeys.orders.detail('o1').slice(0, 1)).toEqual(queryKeys.orders.all);
    expect(queryKeys.customers.detail('c1').slice(0, 1)).toEqual(queryKeys.customers.all);
  });

  it('nests the customer-orders key under orders', () => {
    expect(queryKeys.orders.byCustomerEmail('a@b.com').slice(0, 1)).toEqual(queryKeys.orders.all);
  });

  it('gives different ids different keys', () => {
    expect(queryKeys.products.detail('p1')).not.toEqual(queryKeys.products.detail('p2'));
  });

  it('gives every collection a distinct root', () => {
    const roots = [
      queryKeys.products.all[0],
      queryKeys.orders.all[0],
      queryKeys.customers.all[0],
      queryKeys.settings.all[0],
    ];

    expect(new Set(roots).size).toBe(roots.length);
  });
});

describe('useProducts', () => {
  it('loads the catalog', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useProducts(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('caches under the collection key, so an invalidation reaches it', async () => {
    const { client, Wrapper } = wrapper();

    const { result } = renderHook(() => useProducts(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(queryKeys.products.all)).toBeTruthy();
  });
});

describe('useProduct', () => {
  it('does not fire without an id', async () => {
    // Otherwise the app requests `/api/products/undefined` on every mount of a
    // detail view that has not resolved its route param yet.
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useProduct(undefined), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(productsApi.get).not.toHaveBeenCalled();
  });

  it('fires once an id arrives', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useProduct('p1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productsApi.get).toHaveBeenCalledWith('p1');
  });
});

describe('useCreateProduct', () => {
  it('invalidates the catalog after a create', async () => {
    // Without this the register keeps showing the old list, and the product a
    // manager just added appears to have failed to save.
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateProduct(), { wrapper: Wrapper });
    result.current.mutate({ name: 'Tea', category: 'Drinks', basePrice: 1 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.products.all });
  });

  it('does not invalidate when the create fails', async () => {
    // Refetching after a failure would hide the error behind a list that looks
    // unchanged for the right reason.
    vi.mocked(productsApi.create).mockRejectedValueOnce(new Error('nope'));
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateProduct(), { wrapper: Wrapper });
    result.current.mutate({ name: 'Tea', category: 'Drinks', basePrice: 1 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
