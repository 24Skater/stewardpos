import config from './config';
import logger from './utils/logger';
import db from './services/database';
import { verifyStorage } from './storage';
import app from './app';

const PORT = config.port;
const HOST = config.host;

const startServer = async () => {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const isConnected = await db.testConnection();

    if (!isConnected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }

    logger.info('✅ Database connection successful');

    // Before the port opens, not on the first upload: a bucket that does not
    // exist or a volume mounted read-only is a configuration mistake, and the
    // useful moment to report one is at startup with the operator watching.
    await verifyStorage();

    app.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
      logger.info(`📊 Environment: ${config.nodeEnv}`);
      logger.info(`🗄️  Database: ${config.database.adapter}`);
      logger.info(`🖼️  Uploads: ${config.storage.adapter}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  await db.close();
  process.exit(0);
});

export default app;
