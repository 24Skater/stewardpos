import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../keys';
import type { ReportRangeQuery } from '@/lib/api';

/**
 * Report queries are keyed on both the range and the register/location/cashier
 * filter. If a filter change did not change the key, switching a register
 * filter would show the previous filter's figures under the new heading —
 * silently, since nothing would re-fetch.
 */
vi.mock('@/lib/api', () => ({
  reportsApi: {
    salesByRegister: vi.fn(() =>
      Promise.resolve({
        registers: [],
        capabilitySplit: {
          drawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
          nonDrawerCapable: { registerCount: 0, orderCount: 0, net: 0 },
        },
      })
    ),
    salesByCashier: vi.fn(() => Promise.resolve([])),
    salesByLocation: vi.fn(() => Promise.resolve([])),
    drawerVarianceByRegister: vi.fn(() => Promise.resolve([])),
    noSaleCounts: vi.fn(() => Promise.resolve([])),
    registerHourly: vi.fn(() => Promise.resolve([])),
  },
}));

const { reportsApi } = await import('@/lib/api');
const {
  useRegisterReport,
  useCashierReport,
  useLossPreventionReport,
  useRegisterHourly,
} = await import('../useReports');

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

describe('queryKeys.reports', () => {
  it('gives an unfiltered range and a register-filtered range different keys', () => {
    const range = { from: '2026-08-01', to: '2026-08-16' };
    const unfiltered = queryKeys.reports.registers(range);
    const filtered = queryKeys.reports.registers({ ...range, registerIds: ['r1'] });

    expect(unfiltered).not.toEqual(filtered);
  });

  it('gives two different register filters different keys', () => {
    const range = { from: '2026-08-01', to: '2026-08-16' };
    const a = queryKeys.reports.registers({ ...range, registerIds: ['r1'] });
    const b = queryKeys.reports.registers({ ...range, registerIds: ['r2'] });

    expect(a).not.toEqual(b);
  });

  it('gives a location filter a different key from a register filter', () => {
    const range = { from: '2026-08-01', to: '2026-08-16' };
    const byRegister = queryKeys.reports.cashiers({ ...range, registerIds: ['r1'] });
    const byLocation = queryKeys.reports.cashiers({ ...range, locationIds: ['r1'] });

    expect(byRegister).not.toEqual(byLocation);
  });

  it('treats an empty filter array the same as no filter at all', () => {
    const range = { from: '2026-08-01', to: '2026-08-16' };
    expect(queryKeys.reports.registers(range)).toEqual(
      queryKeys.reports.registers({ ...range, registerIds: [] })
    );
  });

  it('does not care about filter id order, only membership', () => {
    const range = { from: '2026-08-01', to: '2026-08-16' };
    const a = queryKeys.reports.registers({ ...range, registerIds: ['r1', 'r2'] });
    const b = queryKeys.reports.registers({ ...range, registerIds: ['r2', 'r1'] });

    expect(a).toEqual(b);
  });

  it('gives a period change a different key too', () => {
    const filter = { registerIds: ['r1'] };
    const a = queryKeys.reports.registers({ from: '2026-08-01', to: '2026-08-16', ...filter });
    const b = queryKeys.reports.registers({ from: '2026-07-01', to: '2026-07-16', ...filter });

    expect(a).not.toEqual(b);
  });
});

describe('useRegisterReport', () => {
  it('re-fetches when the filter changes', async () => {
    const { Wrapper } = wrapper();
    const range = { from: '2026-08-01', to: '2026-08-16' };

    const { result, rerender } = renderHook(({ query }) => useRegisterReport(query), {
      wrapper: Wrapper,
      initialProps: { query: range as ReportRangeQuery },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportsApi.salesByRegister).toHaveBeenCalledTimes(1);

    rerender({ query: { ...range, registerIds: ['r1'] } });

    await waitFor(() => expect(reportsApi.salesByRegister).toHaveBeenCalledTimes(2));
    expect(reportsApi.salesByRegister).toHaveBeenLastCalledWith(
      expect.objectContaining({ registerIds: ['r1'] })
    );
  });

  it('does not re-fetch when the range and filter are unchanged', async () => {
    const { Wrapper } = wrapper();
    const range = { from: '2026-08-01', to: '2026-08-16' };

    const { result, rerender } = renderHook(({ query }) => useRegisterReport(query), {
      wrapper: Wrapper,
      initialProps: { query: range as ReportRangeQuery },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ query: { ...range } });

    // A fresh object with the same values must still hash to the same key,
    // or every re-render of the page would refetch.
    expect(reportsApi.salesByRegister).toHaveBeenCalledTimes(1);
  });
});

describe('useCashierReport', () => {
  it('caches under the filter-scoped key', async () => {
    const { client, Wrapper } = wrapper();
    const query = { from: '2026-08-01', to: '2026-08-16', cashierUserIds: ['u1'] };

    const { result } = renderHook(() => useCashierReport(query), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(queryKeys.reports.cashiers(query))).toBeDefined();
  });
});

describe('useLossPreventionReport', () => {
  it('fetches drawer variance and no-sale counts together', async () => {
    const { Wrapper } = wrapper();
    const query = { from: '2026-08-01', to: '2026-08-16' };

    const { result } = renderHook(() => useLossPreventionReport(query), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportsApi.drawerVarianceByRegister).toHaveBeenCalledWith(query);
    expect(reportsApi.noSaleCounts).toHaveBeenCalledWith(query);
    expect(result.current.data).toEqual({ drawerVariance: [], noSales: [] });
  });
});

describe('useRegisterHourly', () => {
  it('does not fire without a register id', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useRegisterHourly(undefined, {}), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(reportsApi.registerHourly).not.toHaveBeenCalled();
  });

  it('fires once a register id is given', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useRegisterHourly('r1', { from: '2026-08-01' }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportsApi.registerHourly).toHaveBeenCalledWith({ from: '2026-08-01', registerId: 'r1' });
  });
});
