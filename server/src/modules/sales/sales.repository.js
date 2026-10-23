import { Sale, SaleAudit } from './sales.model.js';

export const salesRepository = {
  initialize: () => Promise.all([Sale.init(), SaleAudit.init()]),
  enabled: (store, session = null) => Sale.find({ store, isEnabled: true }).session(session).lean(),
  active: (store, at, session = null) => Sale.find({ store, isEnabled: true,
    startsAt: { $lte: at }, endsAt: { $gt: at } }).session(session).lean(),
  hasProductReferences: (store, productId, session) => Sale.exists({ store, productIds: productId }).session(session),
  hasCategoryReferences: (store, categoryId, session) => Sale.exists({ store, categoryId }).session(session),
  list: (store, { page, limit, isEnabled, targetType }) => {
    const filter = { store, ...(isEnabled === undefined ? {} : { isEnabled }), ...(targetType ? { targetType } : {}) };
    return Promise.all([
      Sale.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);
  },
  findById: (store, saleId, session = null) => Sale.findOne({ store, _id: saleId }).session(session).lean(),
  create: async (data, session) => (await Sale.create([data], { session }))[0].toObject(),
  update: (store, saleId, fields, session) => Sale.findOneAndUpdate({ store, _id: saleId },
    { $set: fields }, { returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (store, saleId, session) => Sale.deleteOne({ store, _id: saleId }, { session }),
  audit: (data, session) => SaleAudit.create([data], { session }),
};
