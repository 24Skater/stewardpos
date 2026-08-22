import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation } from '@tanstack/react-query';
import { Lock, ShieldAlert } from 'lucide-react';
import PinPad from './PinPad';
import { ApiClientError } from '@/lib/api-client';
import { authApi } from '@/lib/api';
import { authStore } from '@/lib/auth-store';
import { getErrorMessage } from '@/lib/errors';
import { PIN_INVALID, PIN_LOCKED } from '@/lib/register-error-codes';
import type { TillSession } from '@/lib/api';

/**
 * Full-screen sign-on gate for a till that requires a cashier PIN.
 *
 * Mounted from two places, and it does the same thing in both: `RequireTill`
 * shows it as the terminal's front door when no session is open, and `POS.tsx`
 * lays it over a running screen when a shift ends under a cashier (sign-out or
 * idle timeout). It does not take a register — `POST /api/auth/till` reads the
 * terminal's `X-Register-Token`, so the device itself selects which till this
 * is, and a screen that accepted a register id could be pointed at one the
 * device is not paired to.
 *
 * The PIN buys a *session*, not just a shift: the token it returns is what
 * every later request authenticates with, which is why an unpaired or
 * signed-off terminal has nothing behind this screen to leak. It
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
  /**
   * So a cashier at a bank of tills knows which one this is.
   *
   * Optional because the front-door mount has no session yet and therefore no
   * way to have loaded the register — only a caller already inside the POS can
   * name it.
   */
  displayCode?: string;
  /** The org's configured PIN length — sizes the pad, does not gate submission. */
  pinLength?: number;
  /** Called once the session is stored, so a caller can take the screen down. */
  onUnlocked?: (session: TillSession) => void;
}

export default function LockScreen({ displayCode, pinLength, onUnlocked }: LockScreenProps) {
  const [failure, setFailure] = useState<{ kind: FailureKind; message: string } | null>(null);

  const signOn = useMutation({
    mutationFn: (pin: string) => authApi.till({ pin }),
    onSuccess: (session) => {
      // Stored before the callback fires: `RequireTill` reads the token
      // synchronously to decide whether to keep showing this screen, so the
      // other order flashes the pad back over a till that just signed on.
      authStore.setToken(session.token, session.expiresIn);
      onUnlocked?.(session);
    },
  });

  const handleSubmit = async (pin: string) => {
    setFailure(null);
    try {
      await signOn.mutateAsync(pin);
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
              {displayCode ? (
                <>
                  Sign on to <span className="font-medium text-foreground">{displayCode}</span> with your
                  PIN to continue.
                </>
              ) : (
                <>Sign on with your PIN to continue.</>
              )}
            </DialogPrimitive.Description>
          </div>

          <PinPad expectedLength={pinLength} onSubmit={handleSubmit} submitting={signOn.isPending} />

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
