import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { resolveCallerRegister } from '../middleware/registerContext';
import { ValidationError, NotFoundError, UnprocessableEntityError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';

const router = Router();
router.use(authenticate);

/**
 * Cash drawer sessions.
 *
 * A shift's cash handling: the float at open, what the system believes should
 * be in the till, and what was actually counted at close. Without it a store
 * can reconcile nothing — the sales are recorded but the drawer is not, so a
 * shortfall stays invisible until the bank deposit disagrees.
 *
 * Scoped to `orders` rather than `reports`: opening and closing a drawer is part
 * of working a till, so a cashier does it.
 *
 * Since migration 016, a drawer session belongs to a specific register, and
 * more than one register can each have a session open at once. `/current`,
 * `/open`, and `/close` all act on the caller's *own* register, resolved by
 * {@link resolveCallerRegister} — the `X-Register-Id` header when the caller
 * sends one, or the org's lowest-numbered active register otherwise. `/`
 * (the list) is unscoped by default, since it is the admin reconciliation
 * view across every till.
 */

const openSchema = z.object({
  /** Cash placed in the drawer to start. */
  openingFloat: z.number().min(0).default(0),
});

const closeSchema = z.object({
  /** What was actually counted. The variance is computed, never supplied. */
  countedCash: z.number().min(0),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  /** Admin filter: one register's history rather than every till's. */
  registerId: z.string().trim().min(1).optional(),
});

/**
 * GET /api/drawer/current
 * The caller's own register's open session, with what the till should hold
 * right now.
 */
router.get('/current', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const register = await resolveCallerRegister(req);
    const adapter = db.getAdapter();
    const session = await adapter.getOpenDrawerSession(register.id);

    if (!session) {
      // Not an error: no drawer open is a normal state, and the register needs
      // to distinguish it from a failure to ask.
      return res.json({ success: true, data: null });
    }

    const expectedCash = await adapter.getExpectedDrawerCash(String(session.id));

    res.json({ success: true, data: { ...session, expectedCash } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/drawer[?registerId=&limit=]
 * Past sessions, most recent first. Unfiltered by default — the admin
 * reconciliation view across every till.
 */
router.get('/', requirePermission('reports', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { limit, registerId } = listQuerySchema.parse(req.query);
    const sessions = await db.getAdapter().getDrawerSessions(limit ?? 50, registerId);

    res.json({ success: true, data: sessions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * POST /api/drawer/open
 *
 * Refused for a register that cannot physically hold a drawer, or that is
 * not in service — otherwise the variance report accumulates sessions with
 * no till behind them.
 */
router.post('/open', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { openingFloat } = openSchema.parse(req.body);
    const register = await resolveCallerRegister(req);

    if (!register.hasCashDrawer) {
      throw new UnprocessableEntityError(`Register ${register.displayCode} has no cash drawer`);
    }
    if (register.status !== 'active') {
      throw new UnprocessableEntityError(`Register ${register.displayCode} is not active`);
    }

    const adapter = db.getAdapter();

    // The database enforces one-open-at-a-time per register; this is only for
    // a better message than a raw constraint violation.
    const session = await adapter.openDrawerSession({
      registerId: register.id,
      openingFloat,
      userId: req.user?.id,
    });

    logger.info(
      `Drawer opened on register ${register.displayCode} with a $${openingFloat} float by ${req.user?.email}`
    );
    await audit(req, {
      action: 'create',
      entity: 'settings',
      entityId: String(session.id),
      after: { drawerSession: session },
    });

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * POST /api/drawer/close
 * Count the till and close the caller's own register's open session.
 */
router.post('/close', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { countedCash, notes } = closeSchema.parse(req.body);
    const register = await resolveCallerRegister(req);
    const adapter = db.getAdapter();

    const open = await adapter.getOpenDrawerSession(register.id);
    if (!open) {
      throw new NotFoundError('No drawer session is open on this register');
    }

    // Computed here, not accepted from the caller: the whole point of a
    // reconciliation is that one side of it is not the counter's own claim.
    const expectedCash = await adapter.getExpectedDrawerCash(String(open.id));

    const closed = await adapter.closeDrawerSession(
      String(open.id),
      countedCash,
      expectedCash,
      req.user?.id,
      notes
    );

    if (!closed) {
      // Lost the race with another close; the session is no longer open.
      throw new ValidationError('That drawer session was already closed');
    }

    logger.info(
      `Drawer closed: counted $${countedCash}, expected $${expectedCash}, variance $${closed.variance}`
    );
    await audit(req, {
      action: 'update',
      entity: 'settings',
      entityId: String(closed.id),
      after: { drawerSession: closed },
    });

    res.json({ success: true, data: closed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

export default router;
