import { EmailDelivery } from './delivery.model.js';

export const emailDeliveryRepository = {
  initialize: () => EmailDelivery.init(),
  enqueue: (data, session) => EmailDelivery.updateOne({ store: data.store, resourceId: data.resourceId,
    event: data.event, resourceStatus: data.resourceStatus }, { $setOnInsert: data }, { upsert: true, session }),
  exhaust: at => EmailDelivery.updateMany({ state: 'sending', leaseUntil: { $lte: at }, attempts: { $gte: 5 } },
    { $set: { state: 'failed', leaseId: null, leaseUntil: null, lastCode: 'LEASE_EXPIRED' } }),
  claim: (stores, at, leaseId) => EmailDelivery.findOneAndUpdate({ store: { $in: stores }, attempts: { $lt: 5 },
    $or: [{ state: 'pending', nextAttemptAt: { $lte: at } }, { state: 'sending', leaseUntil: { $lte: at } }] },
    { $set: { state: 'sending', leaseId, leaseUntil: new Date(at.getTime() + 120000) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1, createdAt: 1, _id: 1 }, returnDocument: 'after' }).lean(),
  finish: (id, leaseId, fields) => EmailDelivery.updateOne({ _id: id, state: 'sending', leaseId },
    { $set: { ...fields, leaseId: null, leaseUntil: null } }),
  retryFailed: stores => EmailDelivery.updateMany({ store: { $in: stores }, state: 'failed' },
    { $set: { state: 'pending', attempts: 0, nextAttemptAt: new Date(), lastCode: null } }),
};
