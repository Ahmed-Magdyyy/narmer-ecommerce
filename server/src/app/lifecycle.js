import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from './app.js';
import * as database from '../config/database.js';
import { logger as defaultLogger } from '../shared/utils/logger.js';
import { createBunnyStorage } from '../shared/infrastructure/media/bunny.js';
import { createMediaService } from '../modules/media/media.service.js';
import { createBunnyProofStorage } from '../shared/infrastructure/media/bunny-proof.js';
import { createOrdersService } from '../modules/orders/orders.service.js';
import { createLeadsService } from '../modules/leads/leads.service.js';
import { createBunnyLeadStorage } from '../shared/infrastructure/media/bunny-leads.js';
import { createEmailDelivery } from '../shared/infrastructure/email/delivery.js';
import { createEmailSender } from '../shared/infrastructure/email/email.js';

export async function startServer(config, { db = database, logger = defaultLogger, initialize = async () => {},
  cleanupMedia = () => createMediaService({ storage: createBunnyStorage(config.bunnyPublic), logger }).cleanup(),
  cleanupProofs = () => createOrdersService({ storage:createBunnyProofStorage(config.bunnyProof),logger }).cleanupProofs(),
  cleanupLeadImages = () => createLeadsService({ storage: createBunnyLeadStorage(config.bunnyProof), logger }).cleanupImages(),
  deliverEmails = () => createEmailDelivery({ config, email: createEmailSender(config), logger, sources: {
    b2c: id => createOrdersService({ trackingSecret: config.jwtSecret }).getEmailSource(id),
    b2b: id => createLeadsService({ trackingSecret: config.jwtSecret }).getEmailSource(id),
  } }).drain(),
} = {}) {
  let shuttingDown = false;
  await db.connectDatabase(config);
  let server;
  try {
    await initialize();
    const app = createApp(config, { logger, isReady: () => !shuttingDown && db.isDatabaseReady() });
    server = createServer({ requestTimeout: 30_000, headersTimeout: 15_000 }, app);
    server.listen(config.port, config.host);
    await once(server, 'listening');
  } catch (error) {
    await db.disconnectDatabase();
    throw error;
  }
  let shutdownPromise;
  let cleaning = false;
  let delivering = null;
  const emailTimer = config.smtp && Object.values(config.notificationLinks ?? {}).some(Boolean) ? setInterval(() => {
    if (delivering || shuttingDown) return;
    delivering = Promise.resolve().then(deliverEmails).then(result => {
      if (result.sent || result.failed || result.skipped) logger.info({ event: 'customer_email_delivery', ...result });
    }).catch(() => logger.error({ event: 'customer_email_delivery_deferred' })).finally(() => { delivering = null; });
    return delivering;
  }, 60000) : null;
  emailTimer?.unref();
  const cleanupTimer = config.bunnyPublic || config.bunnyProof ? setInterval(async () => {
    if (cleaning || shuttingDown) return;
    cleaning = true;
    try {
      for(const [configured,work,event] of [[config.bunnyPublic,cleanupMedia,'media_cleanup'],[config.bunnyProof,cleanupProofs,'order_proof_cleanup'],[config.bunnyProof,cleanupLeadImages,'lead_image_cleanup']]) {
        if(!configured)continue;
        try {const result=await work();if(result.removed||result.failed)logger.info({event,...result});}
        catch {logger.error({event:`${event}_deferred`});}
      }
    }
    finally { cleaning = false; }
  }, 60 * 60 * 1000) : null;
  cleanupTimer?.unref();
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (emailTimer) clearInterval(emailTimer);
    shutdownPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.closeAllConnections();
        reject(new Error('Shutdown timed out.'));
      }, 10_000);
      server.close(async error => {
        try {
          if (error) throw error;
          if (delivering) await delivering;
          await db.disconnectDatabase();
          resolve();
        } catch (failure) {
          reject(failure);
        } finally {
          clearTimeout(timeout);
        }
      });
    });
    return shutdownPromise;
  }
  return { server, shutdown };
}
