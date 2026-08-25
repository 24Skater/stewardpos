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
import { TerminalUnavailableError } from '../../terminal/errors';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

const chargeSchema = z.object({
  amount: z.number().int().min(1),
  currency: z.string().default('USD'),
  readerId: z.string().optional(),
  description: z.string().optional(),
  /**
   * The till's id for this checkout attempt.
   *
   * Sent by the client because only the client knows where one attempt ends:
   * a retried request is the same attempt and must not charge twice, while a
   * cashier pressing "try again" after a decline is a new one. Capped at
   * Stripe's own 255-character limit for idempotency keys.
   */
  idempotencyKey: z.string().min(1).max(255).optional(),
});

router.post('/charge', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

    const { amount, currency, readerId, description, idempotencyKey } = parsed.data;
    const dbAdapter = db.getAdapter();
    const register = await resolveCallerRegister(req);
    const { terminal, provider } = await resolveTerminal(dbAdapter, register);

    const startedAt = Date.now();
    const result = await terminal.createCharge(amount, currency, {
      readerId,
      description,
      idempotencyKey,
    });

    await dbAdapter.createTerminalTransaction({
      amount,
      currency,
      provider,
      chargeId: result.chargeId,
      status: result.status,
      readerId,
      startedAt,
    });

    logger.info(`Terminal charge initiated: ${result.chargeId}`);
    res.status(202).json({ success: true, data: result });
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
