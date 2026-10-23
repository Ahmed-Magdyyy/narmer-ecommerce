import { AppError } from '../../shared/errors/app-error.js';
import { notificationsRepository } from './notifications.repository.js';

const roles = ['superAdmin', 'admin', 'moderator'];
const stores = { 'order.placed': 'b2c', 'lead.submitted': 'b2b' };
const titles = { 'order.placed': { en: 'New order', ar: 'طلب جديد' }, 'lead.submitted': { en: 'New request', ar: 'طلب خدمة جديد' } };
const id = value => { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw new AppError(422, 'VALIDATION_ERROR'); return value.toLowerCase(); };
function view(row, locale = 'en', readAt = row.readAt ?? null) {
  return { id: String(row._id), type: row.type, title: titles[row.type][locale],
    resource: { type: row.type === 'order.placed' ? 'order' : 'lead', id: String(row.resourceId) },
    occurredAt: new Date(row.occurredAt).toISOString(), isRead: readAt !== null, readAt: readAt ? new Date(readAt).toISOString() : null };
}
export function createNotificationsService({ auth, repository = notificationsRepository, now = () => new Date() } = {}) {
  const checkStore = store => { if (!['b2c', 'b2b'].includes(store)) throw new AppError(400, 'INVALID_STORE'); };
  async function user(store, identity) { checkStore(store); if (!identity) throw new AppError(401, 'UNAUTHORIZED'); return (await auth.authorizeStaff(store, identity, roles))._id; }
  return {
    async enqueue(data, session) {
      if (!stores[data.event]) return;
      if (stores[data.event] !== data.store || !session) throw new Error('Staff notification requires its correct business transaction.');
      await repository.enqueue({ store: data.store, type: data.event, resourceId: id(data.resourceId), occurredAt: data.eventAt }, session);
    },
    async list(store, identity, input = {}, locale = 'en') {
      const userId = await user(store, identity), page = input.page ?? 1, limit = input.limit ?? 20;
      const result = await repository.list(store, userId, { page, limit, unreadOnly: input.unreadOnly ?? false });
      return { items: result.items.map(row => view(row, locale)), unreadCount: result.unreadCount,
        pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } };
    },
    async unreadCount(store, identity) { return { unreadCount: await repository.unreadCount(store, await user(store, identity)) }; },
    async markRead(store, identity, notificationId, locale = 'en') {
      const userId = await user(store, identity), row = await repository.find(store, id(notificationId));
      if (!row) throw new AppError(404, 'NOTIFICATION_NOT_FOUND');
      let read;
      try { read = await repository.markRead(store, userId, String(row._id), now()); }
      catch (error) { if (error.code !== 11000) throw error; read = await repository.findRead(store, userId, String(row._id)); if (!read) throw error; }
      return view(row, locale, read.readAt);
    },
  };
}
