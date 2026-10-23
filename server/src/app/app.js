import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createBusinessRouter } from './modules.js';
import { AppError } from '../shared/errors/app-error.js';
import { errorHandler } from '../shared/middleware/error-handler.js';
import { requestContext } from '../shared/middleware/request-context.js';
import { sendSuccess } from '../shared/utils/response.js';
import { logger as defaultLogger } from '../shared/utils/logger.js';
import { isDatabaseReady } from '../config/database.js';
import { createApiIpLimiter } from '../shared/middleware/rate-limits.js';

export function createApp(config, {
  logger = defaultLogger, isReady = isDatabaseReady, apiRouter,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestContext(config.defaultLocale, logger));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new AppError(403, 'CORS_DENIED'));
    },
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
    credentials: true,
  }));
  app.use('/api/v1', createApiIpLimiter());
  app.use(express.json({ limit: '100kb' }));
  app.get('/health/live', (req, res) => sendSuccess(res, { code: 'LIVE' }));
  app.get('/health/ready', (req, res, next) => {
    if (!isReady()) return next(new AppError(503, 'NOT_READY'));
    sendSuccess(res, { code: 'READY' });
  });
  app.use('/api/v1', apiRouter ?? createBusinessRouter(config));
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND')));
  app.use(errorHandler(logger));
  return app;
}
