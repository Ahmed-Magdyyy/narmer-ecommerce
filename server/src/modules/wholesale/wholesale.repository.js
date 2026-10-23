import { WholesaleProduct, WholesaleOffer, WholesaleGuard, WholesaleAudit } from './wholesale.model.js';

const model = resource => resource === 'product' ? WholesaleProduct : WholesaleOffer;
function filter(store, input) {
  const selected = { store, ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    ...(input.sourceStore ? { sourceStore: input.sourceStore } : {}), ...(input.productId ? { productId: input.productId } : {}) };
  if (input.q) {
    const literal = input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    selected.$or = ['name.ar', 'name.en'].map(key => ({ [key]: { $regex: literal, $options: 'i' } }));
  }
  if (input.eligible) selected.$and = [{ $or: ['b2c', 'b2b'].map(sourceStore => ({ sourceStore, productId: { $in: input.eligible[sourceStore] } })) }];
  return selected;
}
export const wholesaleRepository = {
  async initialize() {
    await Promise.all([WholesaleProduct.init(), WholesaleOffer.init(), WholesaleGuard.init(), WholesaleAudit.init()]);
    await WholesaleGuard.updateOne({ _id: 'b2b' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  },
  lock: session => WholesaleGuard.findOneAndUpdate({ _id: 'b2b' }, { $inc: { revision: 1 } }, { upsert: true, session }).lean(),
  list: (resource, store, input) => Promise.all([
    model(resource).find(filter(store, input)).sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
    model(resource).countDocuments(filter(store, input)),
  ]),
  find: (resource, store, id, session = null) => model(resource).findOne({ store, _id: id }).session(session).lean(),
  findProducts: (store, ids, session = null) => WholesaleProduct.find({ store, _id: { $in: ids }, isActive: true }).session(session).lean(),
  publicProductIds: async store => (await WholesaleProduct.find({ store, isActive: true }).select('_id').lean()).map(row => String(row._id)),
  create: async (resource, data, session) => (await model(resource).create([data], { session }))[0].toObject(),
  update: (resource, store, id, version, fields, session) => model(resource).findOneAndUpdate({ store, _id: id, version },
    { $set: fields, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (resource, store, id, session) => model(resource).deleteOne({ store, _id: id }, { session }),
  hasProductReferences: async (sourceStore, productId, variantIds, session) => Boolean(await WholesaleOffer.exists({ store: 'b2b', sourceStore, productId,
    ...(variantIds ? { 'composition.variantId': { $in: variantIds } } : {}) }).session(session)),
  audit: (data, session) => WholesaleAudit.create([data], { session }),
};
