import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };

    res.json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Service unavailable',
    });
  }
});

/**
 * GET /api/health/db
 * Database health check
 */
router.get('/db', async (_req: Request, res: Response) => {
  try {
    // TODO: Implement actual database health check
    // For now, return basic status
    res.json({
      status: 'healthy',
      adapter: process.env.DB_ADAPTER || 'postgres',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database unavailable',
    });
  }
});

export default router;
