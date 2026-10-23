import { Media } from './media.model.js';

const scope = (store, kind, targetId) => ({ store, kind, targetId });
const candidates = now => ({ $or: [{ status: 'deletePending' },
  { status: { $in: ['uploading', 'ready'] }, expiresAt: { $lte: now } }] });

export const mediaRepository = {
  initialize: () => Media.init(),
  create: async data => (await Media.create(data)).toObject(),
  ready: (id, now) => Media.findOneAndUpdate({ _id: id, status: 'uploading', expiresAt: { $gt: now } },
    { $set: { status: 'ready' } }, { returnDocument: 'after' }).lean(),
  find: (store, kind, targetId, ids, session) => Media.find({ ...scope(store, kind, targetId), _id: { $in: ids } }).session(session).lean(),
  attach: (store, kind, targetId, ids, now, session) => Media.updateMany({ ...scope(store, kind, targetId), _id: { $in: ids },
    $or: [{ status: 'attached' }, { status: 'ready', expiresAt: { $gt: now } }] }, { $set: { status: 'attached' } }, { session }),
  retire: (store, kind, targetId, ids, session) => Media.updateMany({ ...scope(store, kind, targetId),
    _id: { $in: ids }, status: 'attached' }, { $set: { status: 'deletePending' } }, { session }),
  cleanupCandidates: (now, target) => Media.find({ ...candidates(now), ...(target ?? {}) }).sort({ updatedAt: 1 }).limit(50).lean(),
  claimCleanup: (id, now) => Media.findOneAndUpdate({ _id: id, ...candidates(now) },
    { $set: { status: 'deletePending' } }, { returnDocument: 'after' }).lean(),
  completeCleanup: id => Media.deleteOne({ _id: id, status: 'deletePending' }),
};
