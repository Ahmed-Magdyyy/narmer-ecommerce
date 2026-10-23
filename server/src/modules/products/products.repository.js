import mongoose from 'mongoose';
import { Product, ProductAudit } from './products.model.js';

export const productsRepository = {
  initialize: () => Promise.all([Product.init(), ProductAudit.init()]),
  findById: (store, id, session = null) => Product.findOne({ store, _id: id }).session(session).lean(),
  findByIds: (store, ids, session = null) => Product.find({ store, _id: { $in: ids } }).session(session).lean(),
  browseCandidates: (store, { categoryIds, type }) => Product.find({ store, isActive: true,
    categoryId: { $in: categoryIds }, ...(type ? { type } : {}) })
    .select('type categoryId version price discountedPrice variants._id variants.price variants.discountedPrice variants.values options createdAt')
    .sort({ createdAt: -1, _id: -1 }).lean(),
  publicIds: async (store, categoryIds) => (await Product.find({ store, isActive: true, categoryId: { $in: categoryIds } }).select('_id').lean()).map(row => String(row._id)),
  list: (store, { page, limit, categoryIds, type, isActive, q }) => {
    const filter = { store, ...(categoryIds ? { categoryId: { $in: categoryIds } } : {}),
      ...(type ? { type } : {}), ...(isActive === undefined ? {} : { isActive }) };
    if (q) {
      const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['name.ar', 'name.en', 'slug'].map(key => ({ [key]: { $regex: literal, $options: 'i' } }));
    }
    return Promise.all([
      Product.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
  },
  hasAssignedCategory: async (store, categoryId, session) => Boolean(await Product.exists({ store, categoryId }).session(session)),
  hasSizeChartReferences: async (store, sizeChartId, session) => Boolean(await Product.exists({ store, sizeChartId }).session(session)),
  countSizeChartAssignments: (store, chartIds, session = null) => Product.aggregate([
    { $match: { store, sizeChartId: { $in: chartIds.map(id => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$sizeChartId', count: { $sum: 1 } } },
  ]).session(session),
  create: async (data, session) => (await Product.create([data], { session }))[0].toObject({ flattenMaps: true }),
  update: (store, id, version, fields, session) => Product.findOneAndUpdate({ store, _id: id, version },
    { $set: fields, $inc: { version: 1 } }, { session, returnDocument: 'after', runValidators: true }).lean(),
  remove: (store, id, session) => Product.deleteOne({ store, _id: id }, { session }),
  adjustStock: (store, productId, variantId, quantity, restore, session) => {
    const bounds = restore ? { $lte: 1000000000 - quantity } : { $gte: quantity };
    const filter = { store, _id: productId, ...(variantId
      ? { type: 'variant', variants: { $elemMatch: { _id: variantId, stock: bounds } } }
      : { type: 'simple', stock: bounds }) };
    return Product.updateOne(filter, { $inc: { [variantId ? 'variants.$.stock' : 'stock']: restore ? quantity : -quantity, version: 1 } }, { session });
  },
  audit: (data, session) => ProductAudit.create([data], { session }),
};
