import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError } from '../../utils/errors';
import * as reports from '../../services/reports';

/**
 * Reporting API.
 *
 * GET /api/reports/sales-summary               - gross, discounts, tax, net, refunds, avg ticket
 * GET /api/reports/sales-by-day                 - the same takings as a daily series
 * GET /api/reports/top-products                 - best sellers by revenue
 * GET /api/reports/payment-mix                  - how sales were tendered
 * GET /api/reports/returns-summary               - refunds and the reasons given
 * GET /api/reports/sales-by-register             - how many sales went through each till, plus the web-vs-drawer split
 * GET /api/reports/sales-by-cashier              - sales attributed to whoever rang them
 * GET /api/reports/sales-by-location             - sales rolled up to the site
 * GET /api/reports/drawer-variance-by-register   - which drawers are closing short, and by how much
 * GET /api/reports/no-sale-counts                - drawers opened with nothing rung up, per register
 * GET /api/reports/register-hourly               - one register's trading by local hour of day
 *
 * All read-only, all gated on `reports:read`, all taking the same `?from=&to=`
 * range so that two screens showing the same period cannot disagree about what
 * that period was. Every one of them additionally takes `?registerIds=`,
 * `?locationIds=` and `?cashierUserIds=` (repeatable — `?registerIds=a&registerIds=b`
 * — or comma-separated — `?registerIds=a,b`) to narrow the same report to a
 * subset of tills, sites, or staff. Handlers are thin: the range and filter
 * parsing and the arithmetic live in `services/reports.ts` where they are
 * unit-testable without a database.
 */
const router = Router();

router.use(authenticate);

/** A `?registerIds=`-shaped query value: one string, several, or absent. */
const idListParam = z.union([z.string(), z.array(z.string())]).optional();

/**
 * `.passthrough()` is deliberately not used: an unknown query parameter is
 * ignored rather than rejected, because a stale bookmark carrying one should
 * still render a report.
 */
const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  registerIds: idListParam,
  locationIds: idListParam,
  cashierUserIds: idListParam,
});

const topProductsSchema = rangeSchema.extend({
  limit: z.string().optional(),
});

const registerHourlySchema = rangeSchema.extend({
  registerId: z.string().trim().min(1, '"registerId" is required'),
});

/** Zod failures are 400s, not 500s. */
function badRequest(error: unknown): Error {
  if (error instanceof z.ZodError) {
    return new ValidationError(error.errors[0].message);
  }
  return error as Error;
}

router.get(
  '/sales-summary',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getSalesSummary(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/sales-by-day',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getSalesByDay(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/top-products',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = topProductsSchema.parse(req.query);
      const range = reports.parseRange(query);
      const limit = reports.parseTopProductsLimit(query.limit);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getTopProducts(range, limit, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/payment-mix',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getPaymentMix(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/returns-summary',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getReturnsSummary(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

/**
 * How many sales went through each till — the question this whole phase
 * exists to answer. The web-vs-drawer split rides alongside the per-register
 * list in the same response rather than a separate endpoint, since it is
 * derived from the same rows and is read as a summary of them, not as its own
 * report.
 */
router.get(
  '/sales-by-register',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      const [registers, capabilitySplit] = await Promise.all([
        reports.getSalesByRegister(range, filter),
        reports.getRegisterCapabilitySplit(range, filter),
      ]);
      res.json({ success: true, data: { registers, capabilitySplit } });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/sales-by-cashier',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getSalesByCashier(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/sales-by-location',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getSalesByLocation(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/drawer-variance-by-register',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getDrawerVarianceByRegister(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/no-sale-counts',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = rangeSchema.parse(req.query);
      const range = reports.parseRange(query);
      const filter = reports.parseRegisterFilter(query);
      res.json({ success: true, data: await reports.getNoSaleCounts(range, filter) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

router.get(
  '/register-hourly',
  requirePermission('reports', 'read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = registerHourlySchema.parse(req.query);
      const range = reports.parseRange(query);
      res.json({ success: true, data: await reports.getRegisterHourly(range, query.registerId) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

export default router;
