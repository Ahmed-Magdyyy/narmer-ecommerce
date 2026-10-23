import mongoose from 'mongoose';
import { Notification, NotificationRead } from './notifications.model.js';

export const notificationsRepository = {
  initialize: () => Promise.all([Notification.init(), NotificationRead.init()]),
  enqueue: (data, session) => Notification.updateOne({ store: data.store, type: data.type, resourceId: data.resourceId },
    { $setOnInsert: data }, { upsert: true, session }),
  find: (store, id) => Notification.findOne({ store, _id: id }).lean(),
  list: async (store, userId, { page, limit, unreadOnly }) => {
    const filter = unreadOnly ? [{ $match: { 'reads.0': { $exists: false } } }] : [];
    const [result] = await Notification.aggregate([
      { $match: { store } },
      { $lookup: { from: NotificationRead.collection.name, localField: '_id', foreignField: 'notificationId',
        pipeline: [{ $match: { store, userId: new mongoose.Types.ObjectId(String(userId)) } }], as: 'reads' } },
      { $facet: {
        items: [...filter, { $sort: { occurredAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit },
          { $set: { readAt: { $ifNull: [{ $arrayElemAt: ['$reads.readAt', 0] }, null] } } }, { $unset: 'reads' }],
        total: [...filter, { $count: 'value' }],
        unread: [{ $match: { 'reads.0': { $exists: false } } }, { $count: 'value' }],
      } },
    ]);
    return { items: result.items, total: result.total[0]?.value ?? 0, unreadCount: result.unread[0]?.value ?? 0 };
  },
  unreadCount: async (store, userId) => {
    const [total, read] = await Promise.all([Notification.countDocuments({ store }), NotificationRead.countDocuments({ store, userId })]);
    return Math.max(0, total - read);
  },
  markRead: (store, userId, notificationId, readAt) => NotificationRead.findOneAndUpdate({ store, userId, notificationId },
    { $setOnInsert: { readAt } }, { upsert: true, returnDocument: 'after', runValidators: true }).lean(),
  findRead: (store, userId, notificationId) => NotificationRead.findOne({ store, userId, notificationId }).lean(),
};
