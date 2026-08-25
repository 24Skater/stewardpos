import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError, UnprocessableEntityError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { resolveTerminal } from '../../services/terminalGateway';
import { recordChargeOutcome } from '../../services/paymentOutcome';
import { RefundNotSupportedError } from '../../terminal/errors';

/**
 * Money taken that never became a sale.
 *
 * The payment path can now record a charge before it happens and settle it from
 * either a webhook or a poll, which means an approved charge with no order
 * behind it is a row rather than a mystery. This is where somebody sees those
 * rows and does something about them.
 *
 * Three things an operator can actually do, and deliberately not a fourth:
 *
 * - **Re-check** asks the processor what really happened, for a charge we lost
 *   track of. This is the manual fallback Stripe recommends for missed
 *   webhooks, and on an install Stripe cannot reach it is the only way an
 *   outcome that the till missed will ever arrive.
 * - **Refund** gives the money back, for a charge whose sale was never rung.
 * - **Dismiss** records that a human looked and it needs nothing further —
 *   the sale was rung another way, or reconciled outside the system.
 *
 * There is no "turn this into an order". Creating a sale from here would
 * bypass the register context, open shift, drawer session and override checks
 * that `POST /api/orders` enforces, and would invent line items nobody rang.
 * Refund and re-ring is the honest repair.
 */

const router = Router();
router.use(authenticate);

/**
 * How long a payment may be in flight before it counts as unreconciled.
 *
 * A cashier mid-transaction is not an incident, and a list that fills with
 * sales still in progress is one nobody reads. Five minutes is comfortably
 * longer than any reader interaction and far shorter than a shift.
 */
const IN_FLIGHT_GRACE_MS = 5 * 60 * 1000;

const querySchema = z.object({
  /** Override the grace period, in minutes, for looking at recent activity. */
  withinMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const dismissSchema = z.object({
  reason: z.string().min(1, 'Say why this needs nothing further').max(500),
});

router.get('/', requirePermission('reports', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

    const grace =
      parsed.data.withinMinutes !== undefined
        ? parsed.data.withinMinutes * 60 * 1000
        : IN_FLIGHT_GRACE_MS;

    const attempts = await db
      .getAdapter()
      .listUnreconciledAttempts({ olderThanMs: grace, limit: parsed.data.limit });

    res.json({ success: true, data: attempts });
  } catch (error) {
    next(error);
  }
});

/** The attempt, or a 404 that says so. */
async function loadAttempt(id: string) {
  const attempt = await db.getAdapter().getPaymentAttemptById(id);
  if (!attempt) throw new NotFoundError('That payment could not be found');
  return attempt;
}

/**
 * Ask the processor what actually happened.
 *
 * For a charge whose outcome we never learned — a missed webhook, a till that
 * closed mid-sale. The answer settles the attempt through the same handler both
 * feeds use, so a re-check cannot reach a different conclusion than a webhook
 * would have.
 */
router.post('/:id/recheck', requirePermission('reports', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const attempt = await loadAttempt(req.params.id);
    if (!attempt.chargeId) {
      throw new UnprocessableEntityError(
        'This payment never reached the processor, so there is nothing to check.'
      );
    }

    const dbAdapter = db.getAdapter();
    const { terminal } = await resolveTerminal(dbAdapter);
    const status = await terminal.getChargeStatus(attempt.chargeId);

    await recordChargeOutcome(dbAdapter, {
      chargeId: attempt.chargeId,
      status: status.status,
      failureReason: status.declineCode ?? status.errorMessage,
    });

    res.json({
      success: true,
      data: { status: status.status, attempt: await dbAdapter.getPaymentAttemptById(attempt.id) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Give the money back.
 *
 * For a charge that took payment for a sale nobody rang. Refunding the whole
 * amount rather than offering a partial: this is repairing a mistake, not
 * settling a negotiated return, and a partial refund here would leave a
 * remainder that still belongs to nothing.
 */
router.post('/:id/refund', requirePermission('returns', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const attempt = await loadAttempt(req.params.id);
    if (!attempt.chargeId) {
      throw new UnprocessableEntityError('This payment never reached the processor.');
    }
    if (attempt.orderId) {
      throw new UnprocessableEntityError(
        'This payment belongs to a sale. Refund it through Returns so the goods are accounted for.'
      );
    }

    const dbAdapter = db.getAdapter();
    const { terminal } = await resolveTerminal(dbAdapter);

    let refund;
    try {
      refund = await terminal.refundCharge({
        chargeId: attempt.chargeId,
        // Stable per attempt, so a double-click cannot refund the same stranded
        // charge twice.
        idempotencyKey: `reconcile:${attempt.id}`,
      });
    } catch (error) {
      if (error instanceof RefundNotSupportedError) {
        throw new UnprocessableEntityError(error.message);
      }
      throw error;
    }

    if (refund.status === 'failed') {
      throw new UnprocessableEntityError(
        `The refund was declined${refund.failureReason ? ` (${refund.failureReason})` : ''}.`
      );
    }

    await dbAdapter.updatePaymentAttempt(attempt.id, {
      status: 'cancelled',
      // `failure_reason` carries why this attempt is not a completed sale,
      // which covers a deliberate repair as much as a decline.
      failureReason: `Refunded during reconciliation (${refund.refundId})`,
    });

    logger.info(`Reconciliation refund for attempt ${attempt.id}: ${refund.refundId}`);
    await audit(req, {
      action: 'refund',
      entity: 'payment_attempt',
      entityId: attempt.id,
      after: { refundId: refund.refundId, amountCents: attempt.amountCents },
    });

    res.json({ success: true, data: refund });
  } catch (error) {
    next(error);
  }
});

/**
 * Record that a human looked and it needs nothing further.
 *
 * Requires a reason, because a dismissal with no explanation is
 * indistinguishable from someone clearing a list they did not read — and this
 * list is the only place a charge without a sale shows up.
 */
router.post('/:id/dismiss', requirePermission('reports', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = dismissSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

    const attempt = await loadAttempt(req.params.id);
    const dbAdapter = db.getAdapter();

    await dbAdapter.updatePaymentAttempt(attempt.id, {
      status: 'cancelled',
      failureReason: `Dismissed: ${parsed.data.reason}`,
    });

    await audit(req, {
      action: 'update',
      entity: 'payment_attempt',
      entityId: attempt.id,
      after: { dismissed: parsed.data.reason },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
