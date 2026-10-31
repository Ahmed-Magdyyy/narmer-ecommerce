import { randomBytes } from 'node:crypto';
import { emailDeliveryRepository } from './delivery.repository.js';
import { renderNotificationEmail } from './templates.js';
export function createEmailDelivery({ config, email, sources = {}, repository = emailDeliveryRepository, now = () => new Date(), logger = { info() {}, error() {} } }) {
  const stores = () => ['b2c', 'b2b'].filter(store => config.smtp && config.notificationLinks?.[store]);
  return {
    async enqueue(data, session) {
      if (!stores().includes(data.store) || !data.to) return;
      if (!session) throw new Error('Email enqueue requires the business transaction.');
      await repository.enqueue({ ...data, state: 'pending', attempts: 0, nextAttemptAt: data.eventAt }, session);
    },
    async retryFailed() { return repository.retryFailed(stores()); },
    async drain() {
      const result = { sent: 0, failed: 0, skipped: 0 };
      const enabled = stores(); if (!enabled.length) return result;
      await repository.exhaust(now());
      for (let count = 0; count < 20; count++) {
        const leaseId = randomBytes(12).toString('hex'), job = await repository.claim(enabled, now(), leaseId);
        if (!job) break;
        try {
          const source = await sources[job.store](String(job.resourceId));
          if (!source) {
            await repository.finish(job._id, leaseId, { state: 'skipped', lastCode: 'SOURCE_UNAVAILABLE' });
            result.skipped++; continue;
          }
          const link = source.canTrack ? config.notificationLinks[job.store].replace('{id}', String(job.resourceId)).replace('{token}', source.trackingToken ?? '') : null;
          const message = renderNotificationEmail({ store: job.store, event: job.event, status: job.resourceStatus,
            locale: job.locale, name: source.name, reference: job.store === 'b2c' ? source.orderNumber ?? String(job.resourceId) : String(job.resourceId),
            at: job.eventAt, total: source.total, link });
          await email.sendNotification({ to: job.to, ...message });
          await repository.finish(job._id, leaseId, { state: 'sent', sentAt: now(), lastCode: null }); result.sent++;
        } catch {
          await repository.finish(job._id, leaseId, { state: job.attempts >= 5 ? 'failed' : 'pending', lastCode: 'DELIVERY_FAILED',
            nextAttemptAt: new Date(now().getTime() + Math.min(3600000, 60000 * 2 ** (job.attempts - 1))) });
          logger.error({ event: 'customer_email_failed', deliveryId: String(job._id) }); result.failed++; break;
        }
      }
      return result;
    },
  };
}
