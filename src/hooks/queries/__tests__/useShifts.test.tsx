import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../keys';

/**
 * The shift mutations are the only way `useCurrentShift`'s answer ever
 * changes (a sign-on, a sign-out), so both must invalidate the same key that
 * query reads under, or the lock screen and the header cashier name would
 * both go stale the instant a shift actually changes.
 */

const shift = {
  id: 's1',
  registerId: 'reg-1',
  userId: 'u1',
  startedAt: 1,
  lastActivityAt: 1,
  endedAt: null,
  endReason: null,
  createdAt: 1,
};

vi.mock('@/lib/api', () => ({
  registersApi: {
    currentShift: vi.fn(() => Promise.resolve({ shift, cashier: { id: 'u1', name: 'Alex' } })),
    startShift: vi.fn(() => Promise.resolve({ shift, cashier: { id: 'u1', name: 'Alex' } })),
    endShift: vi.fn(() => Promise.resolve({ shift: { ...shift, endedAt: 2, endReason: 'signed_out' } })),
  },
}));

const { registersApi } = await import('@/lib/api');
const { useCurrentShift, useStartShift, useEndShift } = await import('../useShifts');

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

describe('useCurrentShift', () => {
  it('does not fire without a register id', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useCurrentShift(undefined), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(registersApi.currentShift).not.toHaveBeenCalled();
  });

  it('fires once a register id is given', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useCurrentShift('reg-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(registersApi.currentShift).toHaveBeenCalledWith('reg-1');
    expect(result.current.data?.cashier?.name).toBe('Alex');
  });

  it('does not fire when explicitly disabled, even with a register id', async () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useCurrentShift('reg-1', false), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(registersApi.currentShift).not.toHaveBeenCalled();
  });

  it('caches under the register-scoped key', async () => {
    const { client, Wrapper } = wrapper();

    const { result } = renderHook(() => useCurrentShift('reg-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(queryKeys.registers.currentShift('reg-1'))).toBeTruthy();
  });
});

describe('useStartShift', () => {
  it('invalidates that register\'s current-shift key on success', async () => {
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useStartShift(), { wrapper: Wrapper });
    result.current.mutate({ registerId: 'reg-1', pin: '123456' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.registers.currentShift('reg-1') });
  });

  it('does not invalidate anything when the start fails', async () => {
    vi.mocked(registersApi.startShift).mockRejectedValueOnce(new Error('bad_pin'));
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useStartShift(), { wrapper: Wrapper });
    result.current.mutate({ registerId: 'reg-1', pin: '000000' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not invalidate a different register than the one signed on to', async () => {
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useStartShift(), { wrapper: Wrapper });
    result.current.mutate({ registerId: 'reg-1', pin: '123456' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.registers.currentShift('reg-2') });
  });
});

describe('useEndShift', () => {
  it('invalidates that register\'s current-shift key on success', async () => {
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useEndShift(), { wrapper: Wrapper });
    result.current.mutate('reg-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.registers.currentShift('reg-1') });
  });
});
