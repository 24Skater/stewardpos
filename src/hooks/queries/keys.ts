/** The register/location/cashier narrowing a report query can carry, on top of its range. */
interface ReportFilter {
  registerIds?: string[];
  locationIds?: string[];
  cashierUserIds?: string[];
}

/**
 * Normalise a filter's id lists into stable, order-independent key parts.
 *
 * Sorted and joined rather than spread into the key array as-is: TanStack's key
 * hash treats `['a', 'b']` and `['b', 'a']` as different queries, and a
 * multi-select that happens to re-render its selection in a different order
 * must not look like a new filter to the cache. An empty or unset list becomes
 * `''`, the same key part an absent filter produces, so "no filter" is one key
 * regardless of which of the three optional fields the caller omitted.
 */
function filterKeyParts(filter?: ReportFilter): readonly [string, string, string] {
  const norm = (ids?: string[]) => (ids && ids.length > 0 ? [...ids].sort().join(',') : '');
  return [norm(filter?.registerIds), norm(filter?.locationIds), norm(filter?.cashierUserIds)] as const;
}

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
     * Keyed on both the range and the filter, so switching either one
     * re-fetches rather than showing last period's — or last filter's —
     * figures under this heading. Every report key below follows the same
     * shape for the same reason.
     */
    sales: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'sales', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    registers: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'registers', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    cashiers: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'cashiers', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    locations: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'locations', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    drawerVariance: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'drawerVariance', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    noSales: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'noSales', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    /** The two loss-prevention reports fetched together — see `useLossPreventionReport`. */
    lossPrevention: (range: { from?: string; to?: string } & ReportFilter) =>
      ['reports', 'lossPrevention', range.from ?? '', range.to ?? '', ...filterKeyParts(range)] as const,
    /** Keyed on the register too — an hourly breakdown is per-register by definition. */
    hourly: (registerId: string, range: { from?: string; to?: string }) =>
      ['reports', 'hourly', registerId, range.from ?? '', range.to ?? ''] as const,
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
    /** Who is currently signed on to this register — see `useShifts.ts`. */
    currentShift: (id: string) => ['registers', id, 'currentShift'] as const,
    /**
     * The manager-override log — see `useOverrides.ts`. Keyed on the filter,
     * so switching register or approver re-fetches rather than showing the
     * previous filter's page under a new heading. `overridesAll` is the
     * shared prefix every one of those keys sits under, so a newly-granted
     * override can invalidate the whole log in one call regardless of which
     * filter is currently on screen.
     */
    overridesAll: ['registers', 'overrides'] as const,
    overrides: (filter?: { registerId?: string; approverUserId?: string; limit?: number; offset?: number }) =>
      [
        'registers',
        'overrides',
        filter?.registerId ?? '',
        filter?.approverUserId ?? '',
        filter?.limit ?? '',
        filter?.offset ?? '',
      ] as const,
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
