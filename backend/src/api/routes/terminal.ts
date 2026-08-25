import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { resolveCallerRegister } from '../middleware/registerContext';
import {
  ValidationError,
  UnauthorizedError,
  ServiceUnavailableError,
} from '../../utils/errors';
import db from '../../services/database';
import { resolveTerminal } from '../../services/terminalGateway';
import { recordChargeOutcome } from '../../services/paymentOutcome';
import { priceCart, pricingActor } from '../../services/cartPricing';
import { toCents } from '../../services/pricing';
import { getOpenShift } from '../../services/registerShifts';
import { TerminalUnavailableError } from '../../terminal/errors';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

/**
 * How much of this sale a store credit can cover, in minor units.
 *
 * Capped at the sale total so a large credit cannot drive the card amount
 * negative, and refused outright when the code is unusable — a credit that has
 * been spent or voided must not silently reduce what the card is asked for,
 * because the order created afterwards would then not add up.
 */
async function resolveStoreCreditCents(
  dbAdapter: ReturnType<typeof db.getAdapter>,
  code: string,
  totalCents: number
): Promise<number> {
  const credit = (await dbAdapter.getStoreCreditByCode(code)) as
    | { remainingAmount?: number; status?: string }
    | null;

  if (!credit || credit.status !== 'active') {
    throw new ValidationError(`Store credit ${code} cannot be used.`);
  }

  return Math.min(toCents(Number(credit.remainingAmount ?? 0)), totalCents);
}

/**
 * What the till is selling — not what it thinks that costs.
 *
 * There is deliberately no `amount` here. The register used to compute a total
 * and post it, and this route accepted any positive integer, so nothing tied
 * the figure on the card to a cart the server had priced. The cart is the
 * input now; the price is an output.
 */
const chargeSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.string().optional(),
        quantity: z.number().int().min(1),
        notes: z.string().optional(),
      })
    )
    .min(1, 'A card payment needs something to sell'),
  appliedDiscounts: z.array(z.record(z.unknown())).optional().default([]),
  /** Resolved server-side; the credit's share comes off the card, not the sale. */
  storeCreditCode: z.string().optional(),
  currency: z.string().default('USD'),
  readerId: z.string().optional(),
  description: z.string().optional(),
});

router.post('/charge', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

    const { items, appliedDiscounts, storeCreditCode, currency, readerId, description } =
      parsed.data;
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal, provider } = await resolveTerminal(dbAdapter, register);

    // The same function that prices a quote and prices the order, so the figure
    // on the card is the figure recorded, by construction rather than by care.
    const priced = await priceCart(items, appliedDiscounts as never, pricingActor(req.user));

    // A store credit is settled out of band, so it reduces what the card is
    // asked for. Charging the full total here would take the credit's share
    // twice — once off the credit, once off the card — and the order would then
    // be rejected for overpayment, after the customer had already been charged.
    const creditCents = storeCreditCode
      ? await resolveStoreCreditCents(dbAdapter, storeCreditCode, toCents(priced.total))
      : 0;
    const amountCents = toCents(priced.total) - creditCents;

    if (amountCents <= 0) {
      throw new ValidationError(
        'This sale is already covered without a card. Complete it as a store credit payment instead.'
      );
    }

    const openShift = await getOpenShift(dbAdapter, register.id);

    /**
     * Written before the charge, and deliberately not inside it.
     *
     * This row's whole job is to outlive the request. If the browser closes or
     * the server restarts between here and the order, the money still moved,
     * and this is the only thing that says so.
     */
    const attempt = await dbAdapter.createPaymentAttempt({
      registerId: register.id,
      cashierUserId: req.user?.id,
      shiftId: openShift?.id,
      amountCents,
      currency,
      provider,
      cartSnapshot: { items, priced, storeCreditCode, creditCents },
    });

    const startedAt = Date.now();
    let result;
    try {
      result = await terminal.createCharge(amountCents, currency, {
        readerId,
        description,
        // The attempt is the idempotency key as well as the label: one attempt
        // is one payment, so a retry of this request cannot become a second.
        idempotencyKey: attempt.id,
        // No org here yet: tenancy is still deliberately unenforced (migration
        // 014), so there is no org on the caller to carry. The attempt row has
        // the column ready for when there is.
        metadata: {
          attempt_id: attempt.id,
          register_id: register.id,
        },
      });
    } catch (error) {
      await dbAdapter.updatePaymentAttempt(attempt.id, {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Could not start the charge',
      });
      throw error;
    }

    await dbAdapter.updatePaymentAttempt(attempt.id, { chargeId: result.chargeId });

    await dbAdapter.createTerminalTransaction({
      amount: amountCents,
      currency,
      provider,
      chargeId: result.chargeId,
      status: result.status,
      readerId,
      startedAt,
    });

    logger.info(`Terminal charge initiated: ${result.chargeId} (attempt ${attempt.id})`);
    res.status(202).json({
      success: true,
      // The till needs the attempt id to bind the order it creates next.
      data: { ...result, attemptId: attempt.id, amount: amountCents },
    });
  } catch (error) {
    // A reader that is busy, unplugged or unreachable is a shop-floor problem
    // with a shop-floor answer, not a server fault. 503 with the reason keeps
    // the cashier looking at the reader instead of at the till.
    if (error instanceof TerminalUnavailableError) {
      logger.warn(`Terminal unavailable (${error.code}): ${error.message}`);
      return next(new ServiceUnavailableError(error.message));
    }
    next(error);
  }
});

router.get('/status/:chargeId', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chargeId } = req.params;
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal } = await resolveTerminal(dbAdapter, register);

    const result = await terminal.getChargeStatus(chargeId);

    await dbAdapter.updateTerminalTransactionByChargeId(chargeId, {
      status: result.status,
      authCode: result.authCode,
      errorMessage: result.errorMessage,
    });

    // The other feed into the same handler. An install Stripe cannot reach —
    // a shop self-hosting behind a home router — never receives a webhook, so
    // this poll is not a fallback there but the only way an outcome arrives.
    // Both paths settle the attempt through one function so they cannot drift.
    //
    // Bookkeeping must not break the answer: the till is asking whether the
    // customer's card went through, and failing that question because a row
    // could not be updated would strand a cashier mid-sale over something they
    // cannot see or fix.
    try {
      await recordChargeOutcome(dbAdapter, {
        chargeId,
        status: result.status,
        failureReason: result.declineCode ?? result.errorMessage,
      });
    } catch (error) {
      logger.error(`Could not settle the attempt for charge ${chargeId}:`, error);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/cancel/:chargeId', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chargeId } = req.params;
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal } = await resolveTerminal(dbAdapter, register);

    await terminal.cancelCharge(chargeId);
    await dbAdapter.updateTerminalTransactionByChargeId(chargeId, { status: 'cancelled' });

    logger.info(`Terminal charge cancelled: ${chargeId}`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/readers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      throw new UnauthorizedError('Admin access required');
    }
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal } = await resolveTerminal(dbAdapter, register);
    const readers = await terminal.listReaders();
    res.json({ success: true, data: readers });
  } catch (error) {
    next(error);
  }
});

router.post('/test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      throw new UnauthorizedError('Admin access required');
    }
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal } = await resolveTerminal(dbAdapter, register);
    const result = await terminal.testConnection();
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
