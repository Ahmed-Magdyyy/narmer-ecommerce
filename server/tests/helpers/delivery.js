import { randomBytes } from 'node:crypto';
import { createEmailDelivery } from '../../src/shared/infrastructure/email/delivery.js';

export function deliveryFixture() {
  const rows = new Map(), messages = [], logs = [], sources = {}, copy = structuredClone;
  let clock = new Date(), fail = false, failEnqueue = false;
  const now = () => new Date(clock);
  const config = { smtp: {}, notificationLinks: { b2c: 'https://shop.example/orders/{id}#token={token}', b2b: 'https://business.example/requests/{id}#token={token}' } };
  const repository = {
    async enqueue(data) { const key = [data.store, data.resourceId, data.event, data.resourceStatus].join(':');
      if (![...rows.values()].some(row => row.key === key)) { const id = randomBytes(12).toString('hex'); rows.set(id, { ...copy(data), _id: id, key, leaseUntil: null }); }
      if (failEnqueue) throw new Error('email enqueue failed'); },
    async exhaust(at) { for (const row of rows.values()) if (row.state === 'sending' && row.leaseUntil <= at && row.attempts >= 5) Object.assign(row, { state: 'failed', leaseId: null, leaseUntil: null, lastCode: 'LEASE_EXPIRED' }); },
    async claim(stores, at, leaseId) { const row = [...rows.values()].find(row => stores.includes(row.store) && row.attempts < 5
      && ((row.state === 'pending' && row.nextAttemptAt <= at) || (row.state === 'sending' && row.leaseUntil <= at)));
      if (!row) return null; Object.assign(row, { state: 'sending', leaseId, leaseUntil: new Date(at.getTime() + 120000), attempts: row.attempts + 1 }); return copy(row); },
    async finish(id, leaseId, fields) { const row = rows.get(String(id)); if (row?.state !== 'sending' || row.leaseId !== leaseId) return { matchedCount: 0 };
      Object.assign(row, copy(fields), { leaseId: null, leaseUntil: null }); return { matchedCount: 1 }; },
    async retryFailed(stores) { for (const row of rows.values()) if (stores.includes(row.store) && row.state === 'failed') Object.assign(row, { state: 'pending', attempts: 0, nextAttemptAt: now(), lastCode: null }); },
  };
  const email = { async sendNotification(message) { if (fail) throw new Error('SMTP failed with synthetic secret'); messages.push(copy(message)); } };
  const logger = { error(value) { logs.push(value); } };
  const service = createEmailDelivery({ config, repository, email, sources, now, logger });
  const transaction = base => work => base(async session => { const before = copy([...rows]); try { return await work(session); }
    catch (error) { rows.clear(); for (const [key, row] of before) rows.set(key, row); throw error; } });
  return { rows, messages, logs, sources, config, repository, email, service, now, transaction,
    advance(ms) { clock = new Date(clock.getTime() + ms); }, fail(value) { fail = value; }, failEnqueue(value) { failEnqueue = value; } };
}
