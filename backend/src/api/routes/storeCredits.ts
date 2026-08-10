import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';

const router = Router();
router.use(authenticate);

/**
 * Store credit (`store_credits`, migration 003).
 *
 * A refund issued as store credit used to write a row and a code, and that was
 * the end of it — nothing could look the code up and nothing could spend it, so
 * the customer walked out holding a token the system could not honour. These are
 * the two operations that make it real.
 *
 * Redeeming is scoped to `orders` rather than `returns`: spending a credit is
 * part of taking payment, not part of processing a return, so a cashier can do
 * it.
 */

const redeemSchema = z.object({
  amount: z.number().positive(),
  /** The sale it is being spent on, recorded against the credit. */
  orderId: z.string().optional(),
});

/**
 * GET /api/store-credits/:code
 * Look up a credit's balance.
 */
router.get('/:code', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const credit = await db.getAdapter().getStoreCreditByCode(req.params.code);

    if (!credit) {
      throw new NotFoundError('No store credit with that code');
    }

    res.json({ success: true, data: credit });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/store-credits/:code/redeem
 * Spend part or all of a credit.
 */
router.post('/:code/redeem', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const { amount, orderId } = redeemSchema.parse(req.body);
    const adapter = db.getAdapter();

    const redeemed = await adapter.redeemStoreCredit(code, amount, orderId);

    // The adapter refuses in one conditional UPDATE rather than reading first,
    // so a `null` covers every reason at once: no such code, already spent,
    // expired, cancelled, or not enough left. Read it back only to say which,
    // and only for the message.
    if (!redeemed) {
      const existing = await adapter.getStoreCreditByCode(code);
      if (!existing) {
        throw new NotFoundError('No store credit with that code');
      }

      const remaining = Number(existing.remainingAmount ?? 0);
      const expiresAt = existing.expiresAt as number | null;

      if (existing.status !== 'active') {
        throw new ValidationError(`That store credit has already been ${existing.status}`);
      }
      if (expiresAt != null && expiresAt <= Date.now()) {
        throw new ValidationError('That store credit has expired');
      }
      throw new ValidationError(
        `That store credit only has $${remaining.toFixed(2)} left`
      );
    }

    logger.info(`Redeemed $${amount} of store credit ${code}`);
    await audit(req, {
      action: 'update',
      entity: 'return',
      entityId: String(redeemed.returnId ?? redeemed.id),
      after: { storeCreditCode: code, redeemed: amount, remaining: redeemed.remainingAmount },
    });

    res.json({ success: true, data: redeemed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

export default router;
