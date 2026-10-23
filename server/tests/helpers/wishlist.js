import { productFixture } from './products.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createWishlistService } from '../../src/modules/wishlist/wishlist.service.js';

export const emptyWishlistRepository = { async hasProductReferences() { return false; } };

export function wishlistFixture(auth) {
  const p = productFixture(auth);
  const rows = new Map();
  const copy = value => structuredClone(value);
  const key = (store, userId) => `${store}:${userId}`;
  let failure = false;
  const repository = {
    async find(store, userId) { return copy(rows.get(key(store, userId)) ?? null); },
    async add(store, userId, productId) {
      if (failure) throw new Error('wishlist write failed');
      const row = rows.get(key(store, userId)) ?? { store, userId, productIds: [] };
      if (!row.productIds.includes(productId)) row.productIds.push(productId);
      rows.set(key(store, userId), row); return copy(row);
    },
    async remove(store, userId, productId) {
      if (failure) throw new Error('wishlist write failed');
      const row = rows.get(key(store, userId));
      if (row) row.productIds = row.productIds.filter(id => id !== productId);
      return copy(row ?? null);
    },
    async clear(store, userId) {
      if (failure) throw new Error('wishlist write failed');
      rows.delete(key(store, userId));
    },
    async hasProductReferences(store, productId) {
      return [...rows.values()].some(row => row.store === store && row.productIds.includes(productId));
    },
  };
  const transaction = work => p.transaction(async session => {
    const snapshot = copy([...rows]);
    try { return await work(session); }
    catch (error) { rows.clear(); for (const [key, row] of snapshot) rows.set(key, row); throw error; }
  });
  let wishlist;
  const products = createProductsService({ auth, categories: p.categories, repository: p.repository, transaction,
    references: { hasProductReferences: (store, id, variants, session) => variants ? false : wishlist.hasProductReferences(store, id, session) } });
  wishlist = createWishlistService({ auth, products, repository, transaction });
  return { ...p, products, wishlist, wishlistRows: rows, wishlistRepository: repository, transaction,
    failWrite(value) { failure = value; } };
}
