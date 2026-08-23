import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout, Button, Input, Label } from '@steward-apps/ui';
import { registersApi } from '@/lib/api';
import type { Register } from '@/lib/api';
import { setDeviceToken, setSelectedRegisterId } from '@/lib/register-device';
import { ApiClientError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';

/**
 * Pair this terminal to a register.
 *
 * Reachable with no user session — see `App.tsx`, where this route is
 * declared outside `RequireAuth`, the same way `/login` is. A till pairing
 * for the first time has no session to present; that is exactly the problem
 * a device credential (Phase 3) exists to solve. An operator reads an
 * 8-character code off the admin console (`AdminRegisters.tsx`, "Generate
 * pairing code") and types it in here.
 */

/** Excludes 0/O/1/I/L — mirrors `PAIRING_CODE_ALPHABET` in `registerEnrolment.ts`. */
const PAIRING_CODE_LENGTH = 8;

/**
 * Strip whitespace and the `-` separator, uppercase. This mirrors the
 * backend's own `normalizePairingCode` and is safe precisely because it is
 * lossless: dashes and case carry no information a person could get wrong.
 * It must NOT go further than that — swapping a typed `O` for `0` (or
 * similar) would be guessing at what someone meant to type on a credential,
 * which is worse than making them retype it correctly.
 */
function normalizeCodeInput(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

type PairFailureReason = 'unknown' | 'expired' | 'already_redeemed' | 'retired' | 'incomplete' | 'other';

/**
 * Classify a failed `POST /pair` so each distinct backend outcome gets its
 * own plain-language message instead of one generic "invalid code" that
 * would send someone with an *expired* code hunting for a typo that isn't
 * there. The backend has no structured discriminator for the three 401
 * outcomes (unknown / expired / already redeemed) — see the note on
 * `isRegisterTokenFailure` in `api-client.ts` for the same situation on the
 * revoke path — so this matches on the message text `registerEnrolment.ts`
 * is known to send today. A 422 unambiguously means "retired" (the only
 * 422 this route raises), so that one doesn't need text matching.
 */
function classifyPairFailure(error: unknown): PairFailureReason {
  if (!(error instanceof ApiClientError)) return 'other';
  if (error.status === 422) return 'retired';
  if (error.status === 401) {
    const message = error.message.toLowerCase();
    if (message.includes('expired')) return 'expired';
    if (message.includes('already')) return 'already_redeemed';
    return 'unknown';
  }
  return 'other';
}

const PAIR_FAILURE_MESSAGES: Record<Exclude<PairFailureReason, 'other'>, string> = {
  unknown: "That code doesn't match any pairing request. Double-check it against the admin screen and try again.",
  expired: 'That pairing code has expired. Pairing codes are only good for 15 minutes — generate a new one from the admin console.',
  already_redeemed: 'That pairing code has already been used to pair a device. Generate a new one if this till still needs pairing.',
  retired: 'This register has been retired and can no longer be paired. Choose a different register, or create a new one, in the admin console.',
  incomplete: `Enter the full ${PAIRING_CODE_LENGTH}-character pairing code.`,
};

export default function PairRegister() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pairedRegister, setPairedRegister] = useState<Register | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const normalized = normalizeCodeInput(code);
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      setErrorMessage(PAIR_FAILURE_MESSAGES.incomplete);
      return;
    }

    setSubmitting(true);
    try {
      const result = await registersApi.pair(normalized);
      // Both set together: the token authenticates as this specific
      // register, and the legacy X-Register-Id selection is kept in step
      // with it so RegisterSwitcher and the heartbeat hook agree on which
      // till this terminal is. Never render `result.token` — see the
      // handling rules on `setDeviceToken`.
      setDeviceToken(result.token);
      setSelectedRegisterId(result.register.id);
      setPairedRegister(result.register);
    } catch (error: unknown) {
      const reason = classifyPairFailure(error);
      setErrorMessage(
        reason === 'other' ? getErrorMessage(error, 'Could not pair this device. Try again.') : PAIR_FAILURE_MESSAGES[reason]
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (pairedRegister) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center mb-8">
          <Logo variant="lockup" className="mb-6" />
          <CheckCircle2 className="w-10 h-10 text-primary mb-3" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground font-headline">Register paired</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            This terminal is now <span className="font-medium text-foreground">{pairedRegister.displayCode}</span>
            {pairedRegister.name ? ` — ${pairedRegister.name}` : ''}.
          </p>
        </div>
        <Button className="w-full" onClick={() => navigate('/pos', { replace: true })}>
          Continue to POS
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col items-center mb-8">
        <Logo variant="lockup" className="mb-6" />
        <h1 className="text-2xl font-bold text-foreground font-headline">Pair this register</h1>
        <p className="text-sm text-muted-foreground mt-1 text-center">
          Enter the pairing code shown on the admin console to enrol this terminal.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pairing-code">Pairing code</Label>
          <Input
            id="pairing-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-2345"
            autoComplete="off"
            autoCapitalize="characters"
            autoFocus
            aria-describedby="pairing-code-hint"
            className="font-mono text-lg tracking-widest text-center"
          />
          <p id="pairing-code-hint" className="text-xs text-muted-foreground">
            The dash and letter case don't matter — just the 8 characters from the admin screen.
          </p>
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          {submitting ? 'Pairing…' : 'Pair register'}
        </Button>

        {/*
          Where the code actually comes from.

          This screen is the first thing a new terminal shows, and it asks for
          something only the admin console can produce — while, until now,
          linking to nothing at all. Whoever was setting the till up had to
          already know to type /admin into the address bar, and an admin who
          signed in first was bounced straight back here by `RequireTill`:
          signed in, and still stranded on a screen with no way onward.

          /admin rather than /login, so one link serves both cases —
          `RequireAuth` sends a signed-out visitor to /login?next=/admin and
          returns them here-ward afterwards, while someone already signed in
          skips the form entirely.
        */}
        <p className="text-center text-sm text-muted-foreground">
          <a
            href="/admin"
            className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Need a pairing code? Open the admin console
          </a>
        </p>
      </form>
    </AuthLayout>
  );
}
