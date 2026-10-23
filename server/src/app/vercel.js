import { randomUUID } from 'node:crypto';
import { readEnv } from '../config/env.js';
import * as database from '../config/database.js';
import { createApp } from './app.js';
import { initializeModules } from './modules.js';
import { logger as defaultLogger } from '../shared/utils/logger.js';
import { translate } from '../shared/i18n/messages.js';

export function createVercelHandler({ readConfig = readEnv, db = database, initialize = initializeModules,
  makeApp = createApp, logger = defaultLogger } = {}) {
  let ready;
  async function boot() {
    const config = readConfig();
    await db.connectDatabase(config);
    await initialize();
    return makeApp(config, { logger, isReady: db.isDatabaseReady });
  }
  return async (req, res) => {
    let app;
    try {
      ready ??= boot().catch(error => { ready = undefined; throw error; });
      app = await ready;
    } catch {
      // Startup errors can contain database credentials; return only a safe readiness failure.
      const requestId = randomUUID();
      logger.error({ event: 'vercel_startup_failed', requestId, code: 'NOT_READY' });
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: false, code: 'NOT_READY', message: translate('NOT_READY', 'en'), errors: [], requestId }));
      return;
    }
    return app(req, res);
  };
}

export default createVercelHandler();
