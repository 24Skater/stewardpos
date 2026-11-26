import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { reducer, toast, useToast } from '../use-toast';

type State = Parameters<typeof reducer>[0];
const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, open: true, ...extra });

describe('use-toast reducer', () => {
  it('adds a toast to the front and caps the list at one', () => {
    const state: State = { toasts: [t('1')] };

    const next = reducer(state, { type: 'ADD_TOAST', toast: t('2') });

    expect(next.toasts.map((x) => x.id)).toEqual(['2']);
    expect(state.toasts).toHaveLength(1);
  });

  it('updates only the matching toast', () => {
    const state: State = { toasts: [t('1', { title: 'old' })] };

    expect(reducer(state, { type: 'UPDATE_TOAST', toast: { id: '1', title: 'new' } }).toasts[0].title).toBe('new');
    expect(reducer(state, { type: 'UPDATE_TOAST', toast: { id: 'x', title: 'new' } }).toasts[0].title).toBe('old');
  });

  it('closes one toast by id, or every toast with no id', () => {
    const state: State = { toasts: [t('a'), t('b')] };

    const one = reducer(state, { type: 'DISMISS_TOAST', toastId: 'a' });
    const all = reducer(state, { type: 'DISMISS_TOAST' });

    expect(one.toasts.map((x) => x.open)).toEqual([false, true]);
    expect(all.toasts.map((x) => x.open)).toEqual([false, false]);
  });

  it('removes one toast by id, or all with no id', () => {
    const state: State = { toasts: [t('a'), t('b')] };

    expect(reducer(state, { type: 'REMOVE_TOAST', toastId: 'a' }).toasts.map((x) => x.id)).toEqual(['b']);
    expect(reducer(state, { type: 'REMOVE_TOAST' }).toasts).toEqual([]);
  });
});

describe('useToast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows, updates, dismisses and finally removes a toast', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToast());

    let handle!: ReturnType<typeof toast>;
    act(() => {
      handle = result.current.toast({ title: 'Saved' });
    });
    expect(result.current.toasts[0]).toMatchObject({ id: handle.id, title: 'Saved', open: true });

    act(() => handle.update({ id: handle.id, title: 'Saved again' }));
    expect(result.current.toasts[0].title).toBe('Saved again');

    // Radix closing the toast routes through onOpenChange(false).
    act(() => result.current.toasts[0].onOpenChange?.(false));
    expect(result.current.toasts[0].open).toBe(false);

    // A second dismiss of the same id does not queue a second removal.
    act(() => handle.dismiss());
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.toasts).toEqual([]);
    unmount();
  });

  it('dismisses every toast from the hook with no id', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'One' });
    });
    act(() => result.current.dismiss());

    expect(result.current.toasts.every((x) => x.open === false)).toBe(true);
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.toasts).toEqual([]);
  });
});
