import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { wishlistRepository } from './wishlist.repository.js';

const objectId = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw new AppError(422, 'VALIDATION_ERROR');
  return value.toLowerCase();
};
const ids = row => (row?.productIds ?? []).map(String);

export function createWishlistService({ auth, products, repository = wishlistRepository, transaction = runTransaction }) {
  function checkStore(store) { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); }
  async function owner(store, identity, session = null) {
    checkStore(store);
    const user = await auth.authorizeStaff(store, identity, ['user'], session);
    return objectId(String(user._id));
  }
  async function present(store, productIds, locale, session = null) {
    const catalog = await products.getForCart(store, productIds, { session, locale });
    const productsById = new Map(catalog.map(product => [product.id, product]));
    return { items: productIds.map(productId => {
      const product = productsById.get(productId) ?? null;
      return { productId, product, status: product ? 'available' : 'unavailable' };
    }), itemCount: productIds.length };
  }
  async function mutate(store, identity, action, productId, locale) {
    if (action !== 'clear') productId = objectId(productId);
    return transaction(async session => {
      const userId = await owner(store, identity, session);
      await products.lockForCart(store, session);
      let row;
      if (action === 'add') {
        const catalog = await products.getForCart(store, [productId], { session, locale });
        if (!catalog.length) throw new AppError(404, 'PRODUCT_NOT_FOUND');
        const previous = ids(await repository.find(store, userId, session));
        if (previous.length >= 100 && !previous.includes(productId)) throw new AppError(409, 'WISHLIST_LIMIT_EXCEEDED');
        row = await repository.add(store, userId, productId, session);
      } else if (action === 'remove') {
        row = await repository.remove(store, userId, productId, session);
      } else {
        await repository.clear(store, userId, session);
      }
      return present(store, ids(row), locale, session);
    });
  }
  return {
    async get(store, identity, locale) {
      const userId = await owner(store, identity);
      return present(store, ids(await repository.find(store, userId)), locale);
    },
    add: (store, identity, productId, locale) => mutate(store, identity, 'add', productId, locale),
    remove: (store, identity, productId, locale) => mutate(store, identity, 'remove', productId, locale),
    clear: (store, identity, locale) => mutate(store, identity, 'clear', null, locale),
    hasProductReferences(store, productId, session) {
      checkStore(store);
      return repository.hasProductReferences(store, productId, session);
    },
  };
}
