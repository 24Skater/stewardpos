import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { resolveCallerRegister, readOverrideToken } from '../middleware/registerContext';
import { OVERRIDE_REQUIRED } from '../middleware/registerErrorCodes';
import { ValidationError, NotFoundError, ConflictError, UnprocessableEntityError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { consumeOverride, describeOverrideFailure } from '../../services/registerOverrides';

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

    // A drawer closing outside the org's tolerance (migration 019; NULL
    // disables the check) needs a manager override before it can close at
    // all — checked, and the grant consumed, BEFORE the session is actually
    // closed, so a missing or invalid grant leaves the session open rather
    // than closing it and then complaining.
    const orgId = req.orgId ?? DEFAULT_ORG_ID;
    const varianceThreshold = await adapter.getOrganizationDrawerVarianceThreshold(orgId);
    const variance = countedCash - expectedCash;
    if (varianceThreshold != null && Math.abs(variance) > varianceThreshold) {
      const overrideToken = readOverrideToken(req);
      if (!overrideToken) {
        throw new ConflictError(
          `Register ${register.displayCode}'s drawer variance of $${variance.toFixed(2)} exceeds this organization's tolerance and needs a supervisor override`,
          OVERRIDE_REQUIRED,
          { action: 'drawer_variance' }
        );
      }

      const consumed = await consumeOverride(adapter, {
        token: overrideToken,
        action: 'drawer_variance',
        registerId: register.id,
        entity: 'drawer_session',
        entityId: String(open.id),
        beforeValue: expectedCash,
        afterValue: countedCash,
      });
      if (typeof consumed === 'string') {
        throw new ConflictError(describeOverrideFailure(consumed), OVERRIDE_REQUIRED, {
          action: 'drawer_variance',
        });
      }
    }

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

/**
 * POST /api/drawer/no-sale
 *
 * Open the drawer with no sale attached — the single best theft signal in a
 * POS, which is exactly why it needs both a capability flag AND a manager
 * override, not just one:
 *
 * - `can_open_drawer_no_sale` (migration 015) is an absolute, per-register
 *   gate, refused with 422 before an override is even considered — a till
 *   that has never had this turned on cannot be argued into it by a
 *   supervisor PIN. Same reasoning `hasCashDrawer`/`acceptsCash` checks
 *   elsewhere in this file use.
 * - A grant is then always required, with no threshold to clear — unlike
 *   `drawer_variance`, there is no "small enough to not matter" version of
 *   opening the till for nothing.
 *
 * Writes a `register_overrides` row (via `consumeOverride`) rather than a
 * `cash_drawer_sessions` row: this is not a session, counted cash never
 * enters into it, only that it happened, who asked, and who allowed it.
 */
router.post('/no-sale', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const register = await resolveCallerRegister(req);

    if (!register.canOpenDrawerNoSale) {
      throw new UnprocessableEntityError(
        `Register ${register.displayCode} is not permitted to open its drawer without a sale`
      );
    }

    const adapter = db.getAdapter();
    const overrideToken = readOverrideToken(req);
    if (!overrideToken) {
      throw new ConflictError(
        `Opening register ${register.displayCode}'s drawer with no sale needs a supervisor override`,
        OVERRIDE_REQUIRED,
        { action: 'no_sale' }
      );
    }

    const consumed = await consumeOverride(adapter, {
      token: overrideToken,
      action: 'no_sale',
      registerId: register.id,
      entity: 'register',
      entityId: register.id,
    });
    if (typeof consumed === 'string') {
      throw new ConflictError(describeOverrideFailure(consumed), OVERRIDE_REQUIRED, { action: 'no_sale' });
    }

    logger.info(
      `No-sale drawer open on register ${register.displayCode}, approved by ${consumed.override.approverUserId}`
    );
    await audit(req, {
      action: 'create',
      entity: 'register_override',
      entityId: String(consumed.override.id),
      after: { registerId: register.id, action: 'no_sale', approverUserId: consumed.override.approverUserId },
    });

    res.status(201).json({
      success: true,
      data: {
        registerId: register.id,
        approverUserId: consumed.override.approverUserId,
        overrideId: consumed.override.id,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
