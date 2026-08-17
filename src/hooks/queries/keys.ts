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
  registers: {
    all: ['registers'] as const,
    /**
     * Keyed on the filter, so switching location or status re-fetches rather
     * than showing the previous filter's list under a new heading.
     */
    list: (filter?: { locationId?: string; status?: string }) =>
      ['registers', 'list', filter?.locationId ?? '', filter?.status ?? ''] as const,
    detail: (id: string) => ['registers', id] as const,
  },
  locations: {
    /**
     * A location's `registerCount` changes whenever a register under it is
     * created or retired, so register mutations invalidate this key too —
     * see `useRegisters.ts`.
     */
    all: ['locations'] as const,
    detail: (id: string) => ['locations', id] as const,
  },
} as const;
