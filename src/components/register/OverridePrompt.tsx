import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShieldAlert } from 'lucide-react';
import PinPad from './PinPad';
import { useRequestOverride } from '@/hooks/queries';
import { ApiClientError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { PIN_INVALID, PIN_LOCKED } from '@/lib/register-error-codes';
import type { OverrideAction } from '@/lib/api';

/**
 * The dialog that appears when a privileged action — a discount past its
 * approval threshold, a drawer closing outside tolerance, a void, opening the
 * drawer with no sale — is refused with `OVERRIDE_REQUIRED`. A supervisor
 * enters their own PIN here to authorise exactly that one action; it never
 * signs anyone in or out, and the cashier's shift is untouched throughout.
 *
 * Reuses the shared `PinPad`: masked entry, 44px touch targets, keyboard
 * operable, and the PIN itself never becomes a DOM `value` or gets logged —
 * see that component's doc comment. This dialog adds nothing that could leak
 * it; the PIN lives only inside `PinPad`'s own state.
 *
 * This component's job ends at minting the grant: on success it hands the
 * caller a `{ token, expiresAt, action }` via `onGranted` and closes itself.
 * The caller is the one that retries the original action with
 * `X-Override-Token: token` — see `POS.tsx`'s `submitCashOrder`/
 * `completeCardOrder`, `CashDrawerDialog.tsx`, and `QuickReturnDialog.tsx`.
 *
 * Cancelling — Escape, the overlay, the close button — mints nothing and
 * calls nothing: the caller's cart, dialog, and drawer/return state are
 * exactly as they were before this opened.
 */

export interface OverrideGrant {
  token: string;
  /** Epoch ms — ninety seconds from issuance. */
  expiresAt: number;
  action: OverrideAction;
}

export interface OverridePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The till the grant is scoped to — must match the register the retried action runs against. */
  registerId: string;
  action: OverrideAction;
  /**
   * States plainly what is being authorised — "Approve a 40% discount",
   * "Close a drawer $12.50 short", "Void sale #1234", "Open the drawer with
   * no sale". Never a generic "Enter PIN": a supervisor typing a PIN into an
   * unlabelled box is how blanket approvals happen.
   */
  description: string;
  /** The org's configured PIN length — sizes the pad, does not gate submission. */
  pinLength?: number;
  onGranted: (grant: OverrideGrant) => void;
  /**
   * Set by the caller when a grant this prompt issued did not survive the
   * round trip to the action it was minted for — the 90-second window
   * expired before the retry landed, or (rarer) the grant was already spent.
   * The backend deliberately reports both of those, and an unknown or
   * mismatched grant, as the same `OVERRIDE_REQUIRED` — a client is not meant
   * to tell them apart any more finely than "that grant didn't work, ask
   * again" from the outside. Shown as a calm, expected notice rather than an
   * error: the short window is by design, not a failure.
   */
  grantExpired?: boolean;
}

type FailureKind = 'invalid' | 'locked' | 'other';

function classifyFailure(error: unknown): { kind: FailureKind; message: string } {
  if (error instanceof ApiClientError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === PIN_INVALID) {
      return {
        kind: 'invalid',
        message: 'That PIN was not recognised as an override approver. Try again.',
      };
    }
    if (code === PIN_LOCKED) {
      return {
        kind: 'locked',
        // Same wording LockScreen uses for a cashier's own lockout, and for
        // the same reason: never reveal whether a PIN exists, and say it
        // clears on its own so nobody goes hunting for an admin who cannot
        // make it happen any faster than waiting.
        message:
          'This PIN is locked after too many attempts. It clears on its own after a short wait — no admin can speed that up.',
      };
    }
  }
  return { kind: 'other', message: getErrorMessage(error, 'Could not request the override. Try again.') };
}

export default function OverridePrompt({
  open,
  onOpenChange,
  registerId,
  action,
  description,
  pinLength,
  onGranted,
  grantExpired = false,
}: OverridePromptProps) {
  const requestOverride = useRequestOverride();
  const [failure, setFailure] = useState<{ kind: FailureKind; message: string } | null>(null);

  const handleSubmit = async (pin: string) => {
    setFailure(null);
    try {
      const result = await requestOverride.mutateAsync({ registerId, body: { action, pin } });
      onGranted({ token: result.token, expiresAt: result.expiresAt, action: result.action });
      onOpenChange(false);
    } catch (error) {
      setFailure(classifyFailure(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Cancelling mints nothing and retries nothing — reset local state so
        // a reopened prompt starts clean rather than showing a stale failure.
        if (!next) setFailure(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <DialogTitle>Supervisor approval needed</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          A supervisor enters their own PIN to authorise this one action. It does not sign anyone in or
          out, and the cashier's shift is not affected.
        </p>

        {grantExpired && !failure && (
          <p role="status" className="rounded-md bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            That approval expired before it could be used — grants last only 90 seconds, on purpose. Enter
            the PIN again.
          </p>
        )}

        <PinPad expectedLength={pinLength} onSubmit={handleSubmit} submitting={requestOverride.isPending} />

        {failure && (
          <div
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{failure.message}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
