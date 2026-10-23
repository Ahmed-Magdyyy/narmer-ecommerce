import { readEnv } from '../config/env.js';
import { startServer } from './lifecycle.js';
import { logger } from '../shared/utils/logger.js';
import { initializeModules } from './modules.js';

try {
  const { server, shutdown } = await startServer(readEnv(), { initialize: initializeModules });
  logger.info({ event: 'server_started', port: server.address().port });
  let stopping = false;
  async function stop(reason, exitCode) {
    process.exitCode = Math.max(process.exitCode ?? 0, exitCode);
    if (stopping) return;
    stopping = true;
    logger.info({ event: 'server_stopping', reason });
    try {
      await shutdown();
    } catch {
      logger.error({ event: 'shutdown_failed' });
      process.exit(1);
    }
  }
  process.on('SIGINT', () => void stop('SIGINT', 0));
  process.on('SIGTERM', () => void stop('SIGTERM', 0));
  process.on('uncaughtException', () => void stop('uncaughtException', 1));
  process.on('unhandledRejection', () => void stop('unhandledRejection', 1));
} catch {
  // MongoDB errors can include the connection string, so never print the original error.
  logger.error({ event: 'startup_failed', message: 'Check environment settings and MongoDB availability.' });
  process.exit(1);
}
