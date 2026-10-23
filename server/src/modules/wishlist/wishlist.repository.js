import { Wishlist } from './wishlist.model.js';

export const wishlistRepository = {
  initialize: () => Wishlist.init(),
  find: (store, userId, session = null) => Wishlist.findOne({ store, userId }).session(session).lean(),
  add: (store, userId, productId, session) => Wishlist.findOneAndUpdate({ store, userId },
    { $addToSet: { productIds: productId } }, { upsert: true, returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (store, userId, productId, session) => Wishlist.findOneAndUpdate({ store, userId },
    { $pull: { productIds: productId } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  clear: (store, userId, session) => Wishlist.deleteOne({ store, userId }, { session }),
  hasProductReferences: async (store, productId, session) => Boolean(await Wishlist.exists({ store, productIds: productId }).session(session)),
};
