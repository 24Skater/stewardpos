import logger from '../utils/logger';
import type { ChargeStatus } from '../terminal/TerminalPort';
import type { PaymentAttemptStatus } from '../adapters/db/types';

/**
 * What happened to a card payment, recorded once however we heard about it.
 *
 * There are two ways an outcome reaches us and there always will be. A webhook
 * is the one Stripe recommends, and it is the one a hosted install gets. But a
 * shop self-hosting behind a home router has no publicly reachable HTTPS URL
 * and never will, so for that install polling is not a fallback — it is the
 * only way an outcome ever arrives.
 *
 * Both feeds land here. Keeping the decision in one place is what stops us
 * maintaining two payment paths and only ever testing the one our own hosting
 * happens to use.
 */

/** Whichever adapter methods this needs, so it can be exercised without a database. */
interface AttemptStore {
  getPaymentAttemptByChargeId(chargeId: string): Promise<{ id: string; status: string } | null>;
  updatePaymentAttempt(
    id: string,
    patch: { status?: PaymentAttemptStatus; failureReason?: string | null }
  ): Promise<unknown>;
}

export interface ChargeOutcome {
  chargeId: string;
  status: ChargeStatus;
  failureReason?: string;
}

/**
 * A charge status in the attempt's vocabulary.
 *
 * `pending` maps to nothing: the reader is still waiting for a card, and
 * writing that would be churn rather than news.
 */
const OUTCOME_TO_ATTEMPT: Partial<Record<ChargeStatus, PaymentAttemptStatus>> = {
  approved: 'authorized',
  declined: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
};

/**
 * States we will not move an attempt out of.
 *
 * `completed` means an order exists and the sale is settled; a late webhook for
 * the same charge must not drag it back to merely `authorized` and make a
 * finished sale reappear as unreconciled. Events are not ordered, so "late" is
 * ordinary rather than exceptional.
 */
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed']);

export interface OutcomeResult {
  applied: boolean;
  reason?: 'unknown_charge' | 'no_change' | 'already_settled';
}

export async function recordChargeOutcome(
  store: AttemptStore,
  outcome: ChargeOutcome
): Promise<OutcomeResult> {
  const next = OUTCOME_TO_ATTEMPT[outcome.status];
  if (!next) return { applied: false, reason: 'no_change' };

  const attempt = await store.getPaymentAttemptByChargeId(outcome.chargeId);
  if (!attempt) {
    // A charge we have no attempt for is worth saying out loud: it is either a
    // payment taken outside this till or a row that never got written, and both
    // are things somebody should look at.
    logger.warn(`Payment outcome for unknown charge ${outcome.chargeId}`);
    return { applied: false, reason: 'unknown_charge' };
  }

  if (TERMINAL_STATES.has(attempt.status)) {
    return { applied: false, reason: 'already_settled' };
  }

  await store.updatePaymentAttempt(attempt.id, {
    status: next,
    ...(outcome.failureReason !== undefined ? { failureReason: outcome.failureReason } : {}),
  });

  logger.info(`Payment attempt ${attempt.id} is now ${next} (charge ${outcome.chargeId})`);
  return { applied: true };
}
