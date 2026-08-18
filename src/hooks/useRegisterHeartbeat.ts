import { useEffect } from 'react';
import { registersApi } from '@/lib/api';
import { getDeviceToken, getSelectedRegisterId } from '@/lib/register-device';

/** How often an enrolled terminal tells the backend it is still alive. */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Keep an enrolled terminal's `last_seen_at` current while the POS is open.
 *
 * Only runs when a device token is stored — an unenrolled terminal (still on
 * the legacy `X-Register-Id` claim, Phase 2) has nothing to heartbeat as,
 * and calling the endpoint without one would just 401 on every tick for no
 * benefit. The register id to heartbeat against is read once, at mount:
 * `PairRegister.tsx` sets both the token and the selection together on
 * success, so the two always name the same register for the lifetime of
 * this component.
 *
 * A failed heartbeat is swallowed here by design — see the module comment on
 * `api-client.ts`'s 401 handling. The one failure that matters, a revoked
 * token, is already handled globally there (it clears the token and routes
 * to `/pair`); every other failure is transient and not worth interrupting
 * a cashier's screen for, since the next tick will just try again.
 */
export function useRegisterHeartbeat(): void {
  useEffect(() => {
    const registerId = getSelectedRegisterId();
    const token = getDeviceToken();
    if (!token || !registerId) return;

    const beat = () => {
      registersApi.heartbeat(registerId).catch(() => {
        // Silent by design — see the doc comment above.
      });
    };

    beat();
    const intervalId = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);
}
