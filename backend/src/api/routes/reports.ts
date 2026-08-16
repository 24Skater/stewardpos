import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { ValidationError } from '../../utils/errors';
import * as reports from '../../services/reports';

/**
 * Reporting API.
 *
 * GET /api/reports/sales-summary    - gross, discounts, tax, net, refunds, avg ticket
 * GET /api/reports/sales-by-day     - the same takings as a daily series
 * GET /api/reports/top-products     - best sellers by revenue
 * GET /api/reports/payment-mix      - how sales were tendered
 * GET /api/reports/returns-summary  - refunds and the reasons given
 *
 * All read-only, all gated on `reports:read`, all taking the same `?from=&to=`
 * range so that two screens showing the same period cannot disagree about what
 * that period was. Handlers are thin: the range parsing and the arithmetic live
 * in `services/reports.ts` where they are unit-testable without a database.
 */
const router = Router();

router.use(authenticate);

/**
 * `.passthrough()` is deliberately not used: an unknown query parameter is
 * ignored rather than rejected, because a stale bookmark carrying one should
 * still render a report.
 */
const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const topProductsSchema = rangeSchema.extend({
  limit: z.string().optional(),
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
      const range = reports.parseRange(rangeSchema.parse(req.query));
      res.json({ success: true, data: await reports.getSalesSummary(range) });
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
      const range = reports.parseRange(rangeSchema.parse(req.query));
      res.json({ success: true, data: await reports.getSalesByDay(range) });
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
      res.json({ success: true, data: await reports.getTopProducts(range, limit) });
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
      const range = reports.parseRange(rangeSchema.parse(req.query));
      res.json({ success: true, data: await reports.getPaymentMix(range) });
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
      const range = reports.parseRange(rangeSchema.parse(req.query));
      res.json({ success: true, data: await reports.getReturnsSummary(range) });
    } catch (error) {
      next(badRequest(error));
    }
  }
);

export default router;
