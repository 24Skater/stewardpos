import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { resolveCallerRegister, type CallerRegister } from '../middleware/registerContext';
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

/**
 * Which reader field a provider actually reads its device id from.
 *
 * A register stores one `terminal_device_id` because it has one reader; each
 * vendor SDK just calls it something different.
 */
const DEVICE_FIELD_BY_PROVIDER: Record<string, keyof TerminalConfig> = {
  stripe: 'stripeReaderId',
  square: 'squareDeviceId',
  clover: 'cloverDeviceId',
  verifone: 'verifoneTerminalId',
};

/**
 * Build the terminal adapter for the till making the request.
 *
 * Merchant credentials stay org-wide — a secret key or access token identifies
 * the *account*, and every register in a shop bills to the same one. What is
 * per-register is the **device**: three tills have three readers, and until now
 * a single global device id meant every register tried to drive the same one.
 * Two lanes could not take a card at the same time.
 *
 * A register with no binding falls back to the store settings, which is exactly
 * what every existing single-register install already does — so this is
 * additive, not a migration.
 */
async function getAdapter(
  dbAdapter: ReturnType<typeof db.getAdapter>,
  register?: CallerRegister
) {
  const settings = await dbAdapter.getSettings();
  const config = (settings?.config as Record<string, unknown>) || {};
  const paymentMethods = config.paymentMethods as Record<string, unknown> | undefined;
  const card = paymentMethods?.card as Record<string, unknown> | undefined;
  const provider = register?.terminalProvider || (card?.provider as string) || 'generic';
  const creds = (config.terminalCredentials || {}) as Partial<TerminalConfig>;

  // The register's reader wins over the store-wide one when it has been bound.
  const deviceField = DEVICE_FIELD_BY_PROVIDER[provider];
  const binding: Partial<TerminalConfig> =
    register?.terminalDeviceId && deviceField
      ? { [deviceField]: register.terminalDeviceId }
      : {};

  try {
    return { terminal: createTerminalAdapter({ provider, ...creds, ...binding }), provider };
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
    const register = await resolveCallerRegister(req);
    const { terminal, provider } = await getAdapter(dbAdapter, register);

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
    const register = await resolveCallerRegister(req);
    const { terminal } = await getAdapter(dbAdapter, register);

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
    const { terminal } = await getAdapter(dbAdapter, register);

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
    const { terminal } = await getAdapter(dbAdapter, register);
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
    const { terminal } = await getAdapter(dbAdapter, register);
    const result = await terminal.testConnection();
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
