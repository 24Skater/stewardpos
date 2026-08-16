/**
 * Query-key factory.
 *
 * Every key lives here so invalidation is a lookup rather than a guess. Keys are
 * hierarchical — invalidating `queryKeys.products.all` also clears every
 * individual product entry beneath it, because TanStack Query matches on prefix.
 */
export const queryKeys = {
  products: {
    all: ['products'] as const,
    detail: (id: string) => ['products', id] as const,
  },
  orders: {
    all: ['orders'] as const,
    detail: (id: string) => ['orders', id] as const,
    byCustomerEmail: (email: string) => ['orders', 'customer', email] as const,
  },
  customers: {
    all: ['customers'] as const,
    detail: (id: string) => ['customers', id] as const,
  },
  settings: {
    all: ['settings'] as const,
  },
  reports: {
    all: ['reports'] as const,
    /**
     * Keyed on the range, so switching period re-fetches rather than showing
     * last period's figures under this period's heading.
     */
    sales: (range: { from?: string; to?: string }) =>
      ['reports', 'sales', range.from ?? '', range.to ?? ''] as const,
  },
} as const;
