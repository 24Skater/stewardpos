import { useEffect, useRef } from 'react';

/**
 * Fire `onIdle` after `idleSeconds` of no genuine user interaction.
 *
 * "Genuine" means a pointer, keyboard, or touch event — deliberately NOT a
 * background poll or the heartbeat tick (`useRegisterHeartbeat.ts`). Either
 * of those firing on a timer would reset the idle clock forever and the lock
 * screen would never appear, which defeats the entire point of an idle
 * timeout.
 *
 * This is a UI convenience, not the enforcement point: the backend expires an
 * idle shift lazily on its own, the next time anything asks whether a shift
 * is open (see `getOpenShift` in `backend/src/services/registerShifts.ts`).
 * If this timer is late, missed, or this component never mounts, the server
 * still refuses to ring a sale on an idle-expired shift — this just gets the
 * lock screen in front of the cashier promptly rather than leaving them to
 * find out at checkout.
 *
 * Locking must never discard state: this hook only calls `onIdle`, it does
 * not touch the cart or navigate anywhere, so whatever the caller renders
 * behind the lock screen keeps its state as-is.
 */
export function useIdleLock(idleSeconds: number | null | undefined, onIdle: () => void, enabled = true): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through a ref so a caller passing a fresh `onIdle` closure each
  // render does not tear down and rebuild the listeners/timer on every
  // render — only a real change to `idleSeconds`/`enabled` should do that.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || !idleSeconds || idleSeconds <= 0) return;

    const clearPending = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const schedule = () => {
      // Always clear before scheduling again, so an interaction never stacks
      // a second timer alongside the first.
      clearPending();
      timeoutRef.current = setTimeout(() => onIdleRef.current(), idleSeconds * 1000);
    };

    const handleInteraction = () => schedule();

    window.addEventListener('pointerdown', handleInteraction, { passive: true });
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction, { passive: true });

    schedule();

    return () => {
      clearPending();
      window.removeEventListener('pointerdown', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [idleSeconds, enabled]);
}
