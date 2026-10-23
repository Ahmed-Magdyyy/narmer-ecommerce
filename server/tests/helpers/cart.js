import { productFixture } from './products.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createCartService } from '../../src/modules/cart/cart.service.js';

export function cartFixture(auth) {
  const p = productFixture(auth);
  const rows = new Map();
  const copy = value => structuredClone(value);
  const rowKey = (store, ownerKey) => `${store}:${ownerKey}`;
  let clock = new Date('2026-10-11T00:00:00Z');
  let failure = false;
  const repository = {
    async find(store, ownerKey) { return copy(rows.get(rowKey(store, ownerKey)) ?? null); },
    async create(data) {
      if (failure) throw new Error('cart write failed');
      const key = rowKey(data.store, data.ownerKey);
      if (rows.has(key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.set(key, copy(data)); return copy(data);
    },
    async replace(store, ownerKey, version, items, expiresAt) {
      if (failure) throw new Error('cart write failed');
      const previous = rows.get(rowKey(store, ownerKey));
      if (!previous || previous.version !== version) return null;
      const next = { ...previous, items: copy(items), expiresAt, version: version + 1 };
      rows.set(rowKey(store, ownerKey), next); return copy(next);
    },
    async remove(store, ownerKey) {
      if (failure) throw new Error('cart write failed');
      rows.delete(rowKey(store, ownerKey));
    },
    async hasProductReferences(store, productId, variantIds, now) {
      return [...rows.values()].some(row => row.store === store && (!row.expiresAt || row.expiresAt > now)
        && row.items.some(item => item.productId === productId && (!variantIds || variantIds.includes(item.variantId))));
    },
  };
  const transaction = work => p.transaction(async session => {
    const snapshot = copy([...rows]);
    try { return await work(session); }
    catch (error) { rows.clear(); for (const [key, row] of snapshot) rows.set(key, row); throw error; }
  });
  let cart;
  const products = createProductsService({ auth, categories: p.categories, repository: p.repository, transaction,
    references: { hasProductReferences: (...args) => cart.hasProductReferences(...args) } });
  cart = createCartService({ auth, products, repository, transaction, now: () => new Date(clock) });
  return { ...p, products, cart, cartRows: rows, cartRepository: repository, transaction,
    advance(ms) { clock = new Date(clock.getTime() + ms); }, failWrite(value) { failure = value; } };
}
