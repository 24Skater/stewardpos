import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Lock, ShieldAlert } from 'lucide-react';
import PinPad from './PinPad';
import { useStartShift } from '@/hooks/queries';
import { ApiClientError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { PIN_INVALID, PIN_LOCKED } from '@/lib/register-error-codes';
import type { StartShiftResult } from '@/lib/api';

/**
 * Full-screen sign-on gate for a till that requires a cashier PIN.
 *
 * Shown whenever the register has `require_sign_in` and no open shift — see
 * `POS.tsx`, which reads `useCurrentShift` to decide when to mount this. It
 * covers the entire POS: unlike an ordinary dialog, there is no overlay click
 * or Escape key that dismisses it (`onPointerDownOutside`/`onEscapeKeyDown`
 * are both suppressed below) and there is no close control, because a
 * cashier who has not signed on must not be able to see or touch the cart
 * behind it. Radix's `Dialog.Content` still gives this the accessibility
 * plumbing a hand-rolled overlay would have to reinvent: a focus trap, `role="dialog"`,
 * `aria-modal`, and return-focus-on-close.
 */

type FailureKind = 'invalid' | 'locked' | 'other';

function classifyFailure(error: unknown): { kind: FailureKind; message: string } {
  if (error instanceof ApiClientError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === PIN_INVALID) {
      return { kind: 'invalid', message: 'That PIN was not recognised. Try again.' };
    }
    if (code === PIN_LOCKED) {
      return {
        kind: 'locked',
        // Never reveal whether a PIN exists — this is the same wording
        // regardless of whether the PIN belongs to a real, locked account.
        // Says it clears on its own so nobody goes hunting for an admin who
        // cannot make it happen any faster than waiting.
        message:
          'This PIN is locked after too many attempts. It clears on its own after a short wait — no admin can speed that up.',
      };
    }
  }
  return { kind: 'other', message: getErrorMessage(error, 'Could not sign on. Try again.') };
}

export interface LockScreenProps {
  registerId: string;
  /** So a cashier at a bank of tills knows which one this is. */
  displayCode: string;
  /** The org's configured PIN length — sizes the pad, does not gate submission. */
  pinLength?: number;
  /** Called once a shift opens successfully. `useCurrentShift` also picks this up on its own — this is for callers that want to react immediately. */
  onSignedOn?: (result: StartShiftResult) => void;
}

export default function LockScreen({ registerId, displayCode, pinLength, onSignedOn }: LockScreenProps) {
  const startShift = useStartShift();
  const [failure, setFailure] = useState<{ kind: FailureKind; message: string } | null>(null);

  const handleSubmit = async (pin: string) => {
    setFailure(null);
    try {
      const result = await startShift.mutateAsync({ registerId, pin });
      onSignedOn?.(result);
    } catch (error) {
      setFailure(classifyFailure(error));
    }
  };

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background p-6 outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          aria-describedby="lock-screen-description"
        >
          <div className="flex flex-col items-center text-center">
            <Lock className="h-10 w-10 text-muted-foreground mb-3" aria-hidden="true" />
            <DialogPrimitive.Title className="text-2xl font-bold text-foreground">
              Register locked
            </DialogPrimitive.Title>
            <DialogPrimitive.Description id="lock-screen-description" className="text-sm text-muted-foreground mt-1">
              Sign on to <span className="font-medium text-foreground">{displayCode}</span> with your PIN to
              continue.
            </DialogPrimitive.Description>
          </div>

          <PinPad expectedLength={pinLength} onSubmit={handleSubmit} submitting={startShift.isPending} />

          {failure && (
            <div
              role="alert"
              className="flex items-start gap-2 max-w-sm text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
            >
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{failure.message}</span>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
