import { Category, CategoryTree, CategoryAudit } from './categories.model.js';

export const categoriesRepository = {
  async initialize() {
    await Promise.all([Category.init(), CategoryTree.init(), CategoryAudit.init()]);
    await CategoryTree.updateOne({ _id: 'b2c' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  },
  lockTree: (store, session) => CategoryTree.findOneAndUpdate({ _id: store },
    { $inc: { revision: 1 } }, { session, returnDocument: 'after' }).lean(),
  all: (store, session = null) => Category.find({ store }).session(session).sort({ position: 1, _id: 1 }).lean(),
  create: async (data, session) => (await Category.create([data], { session }))[0].toObject(),
  update: (store, id, fields, session) => Category.findOneAndUpdate({ store, _id: id },
    { $set: fields }, { session, returnDocument: 'after', runValidators: true }).lean(),
  remove: (store, id, session) => Category.deleteOne({ store, _id: id }, { session }),
  audit: (data, session) => CategoryAudit.create([data], { session }),
};
