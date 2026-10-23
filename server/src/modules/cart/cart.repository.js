import { Cart } from './cart.model.js';

export const cartRepository = {
  initialize: () => Cart.init(),
  find: (store, ownerKey, session = null) => Cart.findOne({ store, ownerKey }).session(session).lean(),
  create: async (data, session) => (await Cart.create([data], { session }))[0].toObject(),
  replace: (store, ownerKey, version, items, expiresAt, session) => Cart.findOneAndUpdate({ store, ownerKey, version },
    { $set: { items, expiresAt }, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (store, ownerKey, session) => Cart.deleteOne({ store, ownerKey }, { session }),
  hasProductReferences: async (store, productId, variantIds, now, session) => Boolean(await Cart.exists({ store,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    items: { $elemMatch: { productId, ...(variantIds ? { variantId: { $in: variantIds } } : {}) } },
  }).session(session)),
};
