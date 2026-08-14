import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import {
  ValidationError,
  UnauthorizedError,
  ServiceUnavailableError,
} from '../../utils/errors';
import db from '../../services/database';
import {
  createTerminalAdapter,
  TerminalNotConfiguredError,
  type TerminalConfig,
} from '../../terminal/TerminalAdapterFactory';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

const chargeSchema = z.object({
  amount: z.number().int().min(1),
  currency: z.string().default('USD'),
  readerId: z.string().optional(),
  description: z.string().optional(),
});

async function getAdapter(dbAdapter: ReturnType<typeof db.getAdapter>) {
  const settings = await dbAdapter.getSettings();
  const config = (settings?.config as Record<string, unknown>) || {};
  const paymentMethods = config.paymentMethods as Record<string, unknown> | undefined;
  const card = paymentMethods?.card as Record<string, unknown> | undefined;
  const provider = (card?.provider as string) || 'generic';
  const creds = (config.terminalCredentials || {}) as Partial<TerminalConfig>;

  try {
    return { terminal: createTerminalAdapter({ provider, ...creds }), provider };
  } catch (error) {
    // A store that selected a provider and has not saved its credentials yet is
    // misconfigured, not broken. 503 with the reason, rather than the 500 the
    // vendor SDK's own constructor error produced.
    if (error instanceof TerminalNotConfiguredError) {
      throw new ServiceUnavailableError(error.message);
    }
    throw error;
  }
}

router.post('/charge', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

    const { amount, currency, readerId, description } = parsed.data;
    const dbAdapter = db.getAdapter();
    const { terminal, provider } = await getAdapter(dbAdapter);

    const startedAt = Date.now();
    const result = await terminal.createCharge(amount, currency, { readerId, description });

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
    next(error);
  }
});

router.get('/status/:chargeId', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chargeId } = req.params;
    const dbAdapter = db.getAdapter();
    const { terminal } = await getAdapter(dbAdapter);

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
    const { terminal } = await getAdapter(dbAdapter);

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
    const { terminal } = await getAdapter(dbAdapter);
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
    const { terminal } = await getAdapter(dbAdapter);
    const result = await terminal.testConnection();
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
