import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';
import db from '../../services/database';
import config from '../../config';
import { storage } from '../../storage';

const router = Router();

/**
 * GET /api/health
 * Liveness: is this process up and serving?
 *
 * Deliberately checks nothing external. Compose uses this to decide whether the
 * container is alive, and a liveness probe that fails when a *dependency* is
 * down gets the container restarted for someone else's outage — which is both
 * useless and, in a restart loop, actively harmful.
 */
router.get('/', async (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

/**
 * GET /api/health/db
 * Readiness: can this process actually reach what it needs to serve requests?
 *
 * This used to be the body `// TODO: Implement actual database health check`
 * followed by an unconditional `{ status: 'healthy' }` — the catch block that
 * would have answered 503 was unreachable, because nothing inside the try could
 * throw. Nothing consumed it, which is the only reason it never caused an
 * incident: it is exactly the endpoint an operator points a load balancer or an
 * uptime monitor at, and it would never once have gone red.
 *
 * It now does what its name says, for both dependencies the API cannot serve
 * without. Each is reported separately so the answer says *what* is wrong
 * rather than just that something is.
 */
router.get('/db', async (_req: Request, res: Response) => {
  const check = async (what: string, run: () => Promise<boolean>): Promise<boolean> => {
    try {
      const ok = await run();
      if (!ok) logger.warn(`Readiness check failed: ${what} reported not ready`);
      return ok;
    } catch (error) {
      // The reason is logged, never returned. This endpoint is deliberately
      // unauthenticated so a load balancer can poll it, and a driver's error
      // message is exactly the kind of thing that carries a host, a port or a
      // connection string — `ECONNREFUSED 10.0.0.5:5432` names the database to
      // anyone who asks. The prober needs a status code; the operator needs the
      // detail, and has the log.
      logger.warn(`Readiness check failed: ${what}`, { error });
      return false;
    }
  };

  const [database, uploads] = await Promise.all([
    check('database', () => db.testConnection()),
    check('uploads', async () => {
      await storage().verify();
      return true;
    }),
  ]);

  const healthy = database && uploads;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    // Kept at the top level: this is the shape the endpoint has always
    // returned, and something may already be reading it.
    adapter: config.database.adapter,
    timestamp: new Date().toISOString(),
    checks: {
      database: { ok: database, adapter: config.database.adapter },
      uploads: { ok: uploads, adapter: config.storage.adapter },
    },
  });
});

export default router;
