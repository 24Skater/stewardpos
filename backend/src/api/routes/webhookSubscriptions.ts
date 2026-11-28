import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { partialUpdate } from '../../utils/zod';
import db from '../../services/database';
import { audit } from '../../services/audit';
import { EVENT_CATALOG } from '../../services/outbox';
import { encryptSecret } from '../../services/credentialCrypto';
import { assertSafeWebhookUrl, readAllowlist, SsrfError } from '../../services/ssrfGuard';

/**
 * Webhook subscription admin. Secrets are returned once, on create and rotate,
 * and never again; only the encrypted form is stored.
 */
const router = Router();
router.use(authenticate);

const OLD_SECRET_GRACE_MS = 24 * 60 * 60 * 1000;
const DELIVERY_LIST_LIMIT = 200;
const DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'dead'] as const;

const eventTypes = Object.keys(EVENT_CATALOG) as [string, ...string[]];
const createSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(eventTypes)).min(1),
});
const updateSchema = partialUpdate(createSchema.extend({ active: z.boolean() }));

function newSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

/** Turns a guard refusal into a 400; everything else passes through. */
async function checkUrl(url: string): Promise<void> {
  const allowlist = readAllowlist(await db.getAdapter().getSettings());
  try {
    await assertSafeWebhookUrl(url, allowlist);
  } catch (error) {
    if (error instanceof SsrfError) throw new ValidationError(error.message);
    throw error;
  }
}

function fail(error: unknown, next: NextFunction): void {
  next(error instanceof z.ZodError ? new ValidationError(error.issues[0].message) : error);
}

router.get('/', requirePermission('settings', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await db.getAdapter().listWebhookSubscriptions() });
  } catch (error) {
    next(error);
  }
});

router.get('/deliveries', requirePermission('settings', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = z.enum(DELIVERY_STATUSES).optional().parse(req.query.status || undefined);
    res.json({ success: true, data: await db.getAdapter().listWebhookDeliveries(status, DELIVERY_LIST_LIMIT) });
  } catch (error) {
    fail(error, next);
  }
});

router.post('/deliveries/:id/redeliver', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    if (!(await db.getAdapter().redeliverWebhook(id))) throw new NotFoundError('Delivery not found');
    await audit(req, { action: 'update', entity: 'webhook_subscription', entityId: id, after: { redelivered: true } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createSchema.parse(req.body);
    await checkUrl(data.url);
    const secret = newSecret();
    const created = await db.getAdapter().createWebhookSubscription(data.url, encryptSecret(secret), data.events);
    await audit(req, { action: 'create', entity: 'webhook_subscription', entityId: created.id, after: created });
    res.status(201).json({ success: true, data: { ...created, secret } });
  } catch (error) {
    fail(error, next);
  }
});

router.put('/:id', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const patch = updateSchema.parse(req.body);
    if (patch.url) await checkUrl(patch.url);
    const updated = await db.getAdapter().updateWebhookSubscription(String(req.params.id), patch);
    if (!updated) throw new NotFoundError('Webhook subscription not found');
    await audit(req, { action: 'update', entity: 'webhook_subscription', entityId: updated.id, after: updated });
    res.json({ success: true, data: updated });
  } catch (error) {
    fail(error, next);
  }
});

router.delete('/:id', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    if (!(await db.getAdapter().deleteWebhookSubscription(id))) throw new NotFoundError('Webhook subscription not found');
    await audit(req, { action: 'delete', entity: 'webhook_subscription', entityId: id });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/rotate-secret', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secret = newSecret();
    const rotated = await db
      .getAdapter()
      .rotateWebhookSecret(String(req.params.id), encryptSecret(secret), Date.now() + OLD_SECRET_GRACE_MS);
    if (!rotated) throw new NotFoundError('Webhook subscription not found');
    await audit(req, { action: 'update', entity: 'webhook_subscription', entityId: rotated.id, after: { rotated: true } });
    res.json({ success: true, data: { ...rotated, secret } });
  } catch (error) {
    next(error);
  }
});

export default router;
