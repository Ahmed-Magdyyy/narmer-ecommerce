import { randomBytes } from 'node:crypto';
import { emailDeliveryRepository } from './delivery.repository.js';

const labels = {
  en: { pending: 'Pending', accepted: 'Accepted', shipped: 'Shipped', delivered: 'Delivered', canceled: 'Canceled', returned: 'Returned', submitted: 'Submitted', contacted: 'Contacted' },
  ar: { pending: 'قيد المراجعة', accepted: 'مقبول', shipped: 'تم الشحن', delivered: 'تم التسليم', canceled: 'ملغي', returned: 'مرتجع', submitted: 'تم إرسال الطلب', contacted: 'تم التواصل' },
};
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
          const ar = job.locale === 'ar', order = job.store === 'b2c', status = labels[job.locale][job.resourceStatus];
          const title = order ? (ar ? 'تحديث الطلب' : 'Order update') : (ar ? 'تحديث طلب الخدمة' : 'Request update');
          const received = ['order.placed', 'lead.submitted'].includes(job.event);
          const intro = received ? (ar ? 'استلمنا طلبك.' : 'We received your request.') : (ar ? 'تم تسجيل تحديث لطلبك.' : 'An update was recorded for your request.');
          const lines = [ar ? `مرحباً ${source.name}،` : `Hello ${source.name},`, intro,
            `${ar ? 'رقم الطلب' : 'Reference'}: ${order ? source.orderNumber ?? job.resourceId : job.resourceId}`, `${ar ? 'الحالة المسجلة' : 'Recorded status'}: ${status}`,
            `${ar ? 'وقت التحديث' : 'Update time'}: ${new Date(job.eventAt).toISOString()}`];
          if (order) lines.push(`${ar ? 'الإجمالي' : 'Total'}: ${new Intl.NumberFormat(job.locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(source.total / 100)}`);
          if (['canceled', 'returned'].includes(job.resourceStatus)) lines.push(ar ? 'يتولى فريقنا معالجة أي استرداد مالي خارج النظام.' : 'Our staff handles any refund offline.');
          lines.push(link ? (ar ? `تابع آخر حالة لطلبك: ${link}` : `Track the latest status: ${link}`)
            : (ar ? 'رابط التتبع غير متاح في هذا البريد. استخدم الرابط المحفوظ إذا لم تنته صلاحيته، أو تواصل مع فريقنا.'
              : 'A tracking link is unavailable in this email. Use your saved link if it has not expired, or contact our staff.'));
          if (link) lines.push(ar ? 'هذا الرابط خاص. لا تشاركه مع الآخرين.' : 'This link is private. Do not share it.');
          await email.sendNotification({ to: job.to, subject: `Narmer - ${title}`, text: lines.join('\n') });
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
