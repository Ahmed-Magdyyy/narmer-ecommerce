import { Homepage, HomepageAudit } from './homepage.model.js';

export const homepageRepository = {
  initialize: () => Promise.all([Homepage.init(), HomepageAudit.init()]),
  find: (store, session = null) => Homepage.findById(store).session(session).lean(),
  create: async (data, session) => (await Homepage.create([data], { session }))[0].toObject(),
  update: (store, version, fields, session) => Homepage.findOneAndUpdate({ _id: store, version,
    $expr: { $lt: ['$version', Number.MAX_SAFE_INTEGER] } }, { $set: fields, $inc: { version: 1 } },
  { session, returnDocument: 'after', runValidators: true }).lean(),
  audit: (data, session) => HomepageAudit.create([data], { session }),
  hasProductReferences: async (productId, session) => Boolean(await Homepage.exists({ _id: 'b2c',
    $or: [{ 'newArrivals.productIds': productId }, { 'sale.productIds': productId }] }).session(session)),
};
