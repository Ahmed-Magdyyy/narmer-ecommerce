import { AuthChallenge, AuthSession, SuperAdminAssignment } from './auth.model.js';

export const authRepository = {
  initialize: () => Promise.all([AuthChallenge.init(), AuthSession.init(), SuperAdminAssignment.init()]),
  issueChallenge: (data, notAfter) => AuthChallenge.findOneAndUpdate({
    store: data.store, userId: data.userId, purpose: data.purpose,
    $or: [{ lastSentAt: { $lte: notAfter } }, { lastSentAt: { $exists: false } }],
  }, { $set: { digest: data.digest, nonce: data.nonce, authVersion: data.authVersion,
    expiresAt: data.expiresAt, lastSentAt: data.lastSentAt, consumedAt: null, attempts: 0 } },
  { upsert: true, returnDocument: 'after', runValidators: true }).lean(),
  discardChallenge: (store, id, digest) => AuthChallenge.deleteOne({ store, _id: id, digest }),
  attemptChallenge: (store, userId, purpose, now, maxAttempts) => AuthChallenge.findOneAndUpdate({
    store, userId, purpose, consumedAt: null, expiresAt: { $gt: now }, attempts: { $lt: maxAttempts },
  }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }).lean(),
  consumeChallenge: (store, id, digest, now) => AuthChallenge.findOneAndUpdate({
    store, _id: id, digest, consumedAt: null, expiresAt: { $gt: now },
  }, { $set: { consumedAt: now } }, { returnDocument: 'after' }).lean(),
  createSession: async data => (await AuthSession.create(data)).toObject(),
  findSession: (store, id, userId, now, session = null) => AuthSession.findOne({
    store, _id: id, userId, revokedAt: null, expiresAt: { $gt: now },
  }).session(session).lean(),
  rotateSession: (store, id, digest, replacement, now) => AuthSession.findOneAndUpdate({
    store, _id: id, refreshDigest: digest, revokedAt: null, expiresAt: { $gt: now },
  }, { $set: { refreshDigest: replacement } }, { returnDocument: 'after' }).lean(),
  revokeSession: (store, id, userId, now) => AuthSession.updateOne(
    { store, _id: id, userId, revokedAt: null }, { $set: { revokedAt: now } },
  ),
  isSuperAdmin: async (store, userId, session = null) => Boolean(await SuperAdminAssignment.exists({ store, userId }).session(session)),
  findAssignment: (store, session) => SuperAdminAssignment.findOne({ store }).session(session).lean(),
  createAssignment: async (store, userId, session) =>
    (await SuperAdminAssignment.create([{ store, userId }], { session }))[0].toObject(),
  replaceAssignment: (store, currentId, nextId, session) => SuperAdminAssignment.findOneAndUpdate(
    { store, userId: currentId }, { $set: { userId: nextId } }, { returnDocument: 'after', runValidators: true, session },
  ).lean(),
};
