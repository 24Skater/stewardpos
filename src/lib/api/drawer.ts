import { apiClient } from '../api-client';
import { qs } from './qs';

export type DrawerSessionStatus = 'open' | 'closed';

export interface DrawerSession {
  id: string;
  openedBy?: string;
  openedByName?: string | null;
  closedBy?: string | null;
  closedByName?: string | null;
  openedAt: number;
  closedAt?: number | null;
  /** Cash placed in the drawer to start the shift. */
  openingFloat: number;
  /**
   * What the till should hold. Live on the open session, frozen at close.
   *
   * Always computed server-side — a reconciliation is worth nothing if both
   * sides of it come from the same place.
   */
  expectedCash?: number | null;
  countedCash?: number | null;
  /** `counted - expected`. Negative is a shortfall. */
  variance?: number | null;
  notes?: string | null;
  status: DrawerSessionStatus;
}

/**
 * Cash drawer sessions (`backend/src/api/routes/drawer.ts`).
 *
 * Only one session can be open at a time, enforced by a unique index rather than
 * a check — two open drawers would make "which till did this sale go into"
 * unanswerable.
 */
export const drawerApi = {
  /** The open session with live expected cash, or `null` if none is open. */
  current: () => apiClient.get<DrawerSession | null>('/api/drawer/current'),
  history: (limit?: number) => apiClient.get<DrawerSession[]>(`/api/drawer${qs({ limit })}`),
  open: (openingFloat: number) =>
    apiClient.post<DrawerSession>('/api/drawer/open', { openingFloat }),
  /**
   * Close and reconcile. The variance is computed, never sent.
   *
   * `overrideToken` carries a manager-override grant as `X-Override-Token`,
   * required when the variance is outside the organization's tolerance — see
   * `OverridePrompt.tsx` and `backend/src/api/routes/drawer.ts`.
   */
  close: (countedCash: number, notes?: string, overrideToken?: string) =>
    apiClient.post<DrawerSession>(
      '/api/drawer/close',
      { countedCash, notes },
      overrideToken ? { headers: { 'X-Override-Token': overrideToken } } : undefined
    ),
  /**
   * Open the drawer with no sale attached (`POST /api/drawer/no-sale`) — a
   * manager-override grant is always required, with no threshold to clear.
   * Refused with 422 outright, before an override is even considered, on a
   * register whose `canOpenDrawerNoSale` is false — see `CashDrawerDialog.tsx`,
   * which hides the control in that case rather than offering a button that
   * always fails.
   */
  noSale: (overrideToken?: string) =>
    apiClient.post<{ registerId: string; approverUserId: string; overrideId: string }>(
      '/api/drawer/no-sale',
      {},
      overrideToken ? { headers: { 'X-Override-Token': overrideToken } } : undefined
    ),
};
