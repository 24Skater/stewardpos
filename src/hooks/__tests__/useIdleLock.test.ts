import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIdleLock } from '../useIdleLock';

/**
 * The idle timer is only useful if it fires after real silence AND resets on
 * real interaction — a one-sided test (only "it fires") would pass against a
 * timer that never resets, and a test that only checks "it resets" would
 * pass against a timer that never fires. Both directions are asserted here.
 *
 * A background poll or heartbeat tick must NOT count as interaction — those
 * fire on their own timer regardless of whether anyone is at the till, and a
 * hook that reset on them would never lock.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIdleLock', () => {
  it('fires onIdle after idleSeconds of silence', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle));

    vi.advanceTimersByTime(29_000);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('postpones firing when a genuine interaction happens', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle));

    vi.advanceTimersByTime(20_000);
    window.dispatchEvent(new Event('keydown'));

    // Had the timer not reset, it would have fired 10s from here.
    vi.advanceTimersByTime(20_000);
    expect(onIdle).not.toHaveBeenCalled();

    // But 30s after the actual last interaction, it does fire.
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('resets on a pointer interaction', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle));

    vi.advanceTimersByTime(25_000);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(25_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('resets on a touch interaction', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle));

    vi.advanceTimersByTime(25_000);
    window.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(25_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does NOT reset on an unrelated background event (a poll/heartbeat tick)', () => {
    // The regression this guards: a hook that resets on any window event
    // would never fire once a heartbeat or query poll is running.
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle));

    vi.advanceTimersByTime(15_000);
    window.dispatchEvent(new Event('steward:heartbeat-tick'));
    vi.advanceTimersByTime(15_000);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(30, onIdle, false));

    vi.advanceTimersByTime(60_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does nothing when idleSeconds is null or zero', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(null, onIdle));
    const onIdleZero = vi.fn();
    renderHook(() => useIdleLock(0, onIdleZero));

    vi.advanceTimersByTime(60_000);

    expect(onIdle).not.toHaveBeenCalled();
    expect(onIdleZero).not.toHaveBeenCalled();
  });

  it('clears its timer on unmount rather than firing after teardown', () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleLock(30, onIdle));

    unmount();
    vi.advanceTimersByTime(60_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does not stack timers across re-renders with the same idleSeconds', () => {
    const onIdle = vi.fn();
    const { rerender } = renderHook(({ seconds }) => useIdleLock(seconds, onIdle), {
      initialProps: { seconds: 30 },
    });

    // Several re-renders with an unchanged idleSeconds must not create
    // additional timers that would each independently fire onIdle.
    rerender({ seconds: 30 });
    rerender({ seconds: 30 });
    rerender({ seconds: 30 });

    vi.advanceTimersByTime(30_000);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleLock(30, onIdle));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    removeSpy.mockRestore();
  });
});
