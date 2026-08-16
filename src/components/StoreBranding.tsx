import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { queryKeys } from '@/hooks/queries';
import { useSession } from '@/hooks/queries/useSession';
import { applyBrandColor, applyFavicon } from '@/lib/brand-theme';

/**
 * Puts the store's brand on the running app.
 *
 * `brandColor` and `iconUrl` have been storable, validated and returned by the
 * API since the branding migration, and nothing has ever read them: a shop could
 * choose a colour, save it, reload, and see the same gold as everyone else. This
 * component is what makes the setting mean something.
 *
 * It renders nothing and sits above the router, so a brand applies to every
 * screen rather than to whichever ones remembered to ask for it.
 *
 * **Only when signed in.** Settings is an authenticated endpoint, and a 401
 * clears the stored token and sends the browser to `/login`. Fetching it
 * unconditionally from above the router would fire on `/setup` — the first-run
 * wizard, which by definition has no session — and bounce a brand-new install
 * to a login screen with no account to log into. The query shares
 * `queryKeys.settings.all` with `useSettings`, so on a screen that already reads
 * settings this costs no extra request.
 */
export default function StoreBranding() {
  const { data: session } = useSession();

  const { data: settings } = useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => adminApi.settings.get(),
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
    // A branding failure must not surface as an error anywhere; the app simply
    // keeps its default palette.
    retry: false,
  });

  useEffect(() => {
    // `undefined` while the query is in flight means "not known yet", not
    // "cleared" — clearing on every mount would flash the default palette over
    // the store's own on each reload.
    if (!settings) return;

    applyBrandColor(settings.brandColor, document.documentElement);
    applyFavicon(settings.iconUrl, document);
  }, [settings]);

  return null;
}
