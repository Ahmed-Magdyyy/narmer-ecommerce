import { randomBytes } from 'node:crypto';
import { createNotificationsService } from '../../src/modules/notifications/notifications.service.js';

export const emptyNotificationsRepository = { async enqueue() {} };
export function notificationsFixture(auth) {
  const rows = new Map(), reads = new Map(), copy = structuredClone;
  let fail = false, clock = new Date(); const now = () => new Date(clock);
  const key = (store, userId, notificationId) => `${store}:${userId}:${notificationId}`;
  const repository = {
    async enqueue(data) { if (![...rows.values()].some(row => row.store === data.store && row.type === data.type && row.resourceId === data.resourceId)) {
      const id = randomBytes(12).toString('hex'); rows.set(id, { _id: id, ...copy(data) }); }
      if (fail) throw new Error('notification write failed'); },
    async find(store, id) { const row = rows.get(id); return copy(row?.store === store ? row : null); },
    async list(store, userId, { page, limit, unreadOnly }) { const all = [...rows.values()].filter(row => row.store === store)
      .sort((a, b) => b.occurredAt - a.occurredAt || b._id.localeCompare(a._id))
      .map(row => ({ ...copy(row), readAt: reads.get(key(store, userId, row._id))?.readAt ?? null }));
      const items = unreadOnly ? all.filter(row => row.readAt === null) : all;
      return { items: items.slice((page - 1) * limit, page * limit), total: items.length, unreadCount: all.filter(row => row.readAt === null).length }; },
    async unreadCount(store, userId) { return (await this.list(store, userId, { page: 1, limit: 100 })).unreadCount; },
    async markRead(store, userId, notificationId, readAt) { const id = key(store, userId, notificationId);
      if (!reads.has(id)) reads.set(id, { store, userId, notificationId, readAt }); return copy(reads.get(id)); },
    async findRead(store, userId, notificationId) { return copy(reads.get(key(store, userId, notificationId)) ?? null); },
  };
  const transaction = base => work => base(async session => { const before = copy([...rows]); try { return await work(session); }
    catch (error) { rows.clear(); for (const [id, row] of before) rows.set(id, row); throw error; } });
  const service = createNotificationsService({ auth, repository, now });
  return { rows, reads, repository, service, now, transaction, advance(ms) { clock = new Date(clock.getTime() + ms); }, fail(value) { fail = value; } };
}
