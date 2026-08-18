import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Delete, X } from 'lucide-react';

/**
 * Touch-first numeric PIN entry.
 *
 * Built for someone standing at a till, not typing at a desk — every digit,
 * backspace and clear button is at least 44px on a side (the accessibility
 * spec's touch-target floor), and the whole pad also drives from a physical
 * keyboard: digit keys, Backspace, and Enter to submit.
 *
 * Entry is masked by design and stays that way structurally, not just
 * visually: the PIN lives only in this component's own state and is never
 * bound to a DOM `value` attribute or rendered as text — only as a row of
 * filled/empty position dots — and it is never logged. `onSubmit` is the only
 * way it leaves this component.
 *
 * `expectedLength` sizes the dot row (the org's configured PIN length) but
 * does NOT auto-submit on reaching it: an individual cashier's PIN can be
 * longer than the org's floor, so only an explicit Submit press dispatches
 * `onSubmit`.
 */

const MAX_PIN_LENGTH = 12;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export interface PinPadProps {
  /** The org's configured `pin_length` (migration 015 default 6) — sizes the dot row, nothing more. */
  expectedLength?: number;
  onSubmit: (pin: string) => void;
  /** Disables every control while a submitted PIN is being checked. */
  submitting?: boolean;
  /** Disables every control outright, e.g. while a lockout message is shown. */
  disabled?: boolean;
}

export default function PinPad({
  expectedLength = 6,
  onSubmit,
  submitting = false,
  disabled = false,
}: PinPadProps) {
  const [pin, setPin] = useState('');
  const locked = disabled || submitting;

  const appendDigit = useCallback(
    (digit: string) => {
      if (locked) return;
      setPin((current) => (current.length >= MAX_PIN_LENGTH ? current : current + digit));
    },
    [locked]
  );

  const backspace = useCallback(() => {
    if (locked) return;
    setPin((current) => current.slice(0, -1));
  }, [locked]);

  const clear = useCallback(() => {
    if (locked) return;
    setPin('');
  }, [locked]);

  const submit = useCallback(() => {
    if (locked || pin.length === 0) return;
    onSubmit(pin);
    setPin('');
  }, [locked, pin, onSubmit]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      appendDigit(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      backspace();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clear();
    }
  };

  const dotCount = Math.max(expectedLength, pin.length);

  return (
    // A keypad is a composite widget; the group itself takes focus so digit
    // keys work without a mouse ever touching an individual button first.
    <div
      role="group"
      aria-label="PIN entry"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <div className="flex items-center justify-center gap-3 mb-6" aria-hidden="true">
        {Array.from({ length: dotCount }).map((_, index) => (
          <span
            key={index}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              index < pin.length ? 'bg-foreground border-foreground' : 'border-muted-foreground/40'
            }`}
          />
        ))}
      </div>
      {/* Announces progress without ever announcing the digits themselves. */}
      <p className="sr-only" role="status" aria-live="polite">
        {pin.length} digit{pin.length === 1 ? '' : 's'} entered
      </p>

      <div className="grid grid-cols-3 gap-3">
        {DIGITS.map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            className="h-16 w-16 text-2xl font-semibold"
            onClick={() => appendDigit(digit)}
            disabled={locked}
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-16 w-16"
          onClick={clear}
          disabled={locked || pin.length === 0}
          aria-label="Clear PIN entry"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-16 w-16 text-2xl font-semibold"
          onClick={() => appendDigit('0')}
          disabled={locked}
          aria-label="Digit 0"
        >
          0
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-16 w-16"
          onClick={backspace}
          disabled={locked || pin.length === 0}
          aria-label="Backspace"
        >
          <Delete className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <Button
        type="button"
        className="w-full mt-6 h-14 text-lg"
        onClick={submit}
        disabled={locked || pin.length === 0}
      >
        {submitting ? 'Checking…' : 'Submit'}
      </Button>
    </div>
  );
}
