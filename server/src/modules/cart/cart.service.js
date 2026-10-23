import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { cartRepository } from './cart.repository.js';

export const guestCartLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const objectId = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid();
  return value.toLowerCase();
};
const guestKey = token => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(401, 'UNAUTHORIZED');
  return `g:${createHash('sha256').update(token).digest('hex')}`;
};
const key = line => `${line.productId}:${line.variantId ?? ''}`;
const lines = (row, now) => row && (!row.expiresAt || new Date(row.expiresAt) > now)
  ? row.items.map(item => ({ productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : null, quantity: item.quantity })) : [];

export function createCartService({ auth, products, repository = cartRepository, transaction = runTransaction, now = () => new Date() }) {
  function checkStore(store) { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); }
  async function owner(store, input, session = null) {
    checkStore(store);
    if (input?.identity) {
      const user = await auth.authorizeStaff(store, input.identity, ['user'], session);
      return { ownerKey: `u:${objectId(String(user._id))}`, guest: false };
    }
    return { ownerKey: guestKey(input?.guestToken), guest: true };
  }
  async function catalogue(store, items, session, locale, at) {
    const rows = await products.getForCart(store, [...new Set(items.map(item => item.productId))], { session, locale, at });
    return new Map(rows.map(row => [row.id, row]));
  }
  function sellable(product, line) {
    if (!product) return null;
    if (product.type === 'simple') return line.variantId === null ? product : null;
    return product.variants.find(variant => variant.id === line.variantId) ?? null;
  }
  async function present(store, items, session, locale = 'en', at = now()) {
    const rows = await catalogue(store, items, session, locale, at);
    const entries = items.map(line => {
      const product = rows.get(line.productId);
      const item = sellable(product, line);
      return { ...line,
        name: item ? product.name : null, slug: item ? product.slug : null,
        images: item ? (item.images ?? product.images) : [], values: item?.values ?? null,
        sku: item?.sku ?? null, price: item?.price ?? null, discountedPrice: item?.discountedPrice ?? null,
        activeSale: item?.activeSale ?? null,
        unitPrice: item?.effectivePrice ?? null, stock: item?.stock ?? null,
        lineTotal: item ? item.effectivePrice * line.quantity : null,
        status: !item ? 'unavailable' : line.quantity > item.stock ? 'insufficient_stock' : 'available',
      };
    });
    return { items: entries, itemCount: items.reduce((total, item) => total + item.quantity, 0),
      subtotal: entries.some(item => item.lineTotal === null) ? null : entries.reduce((total, item) => total + item.lineTotal, 0),
      currency: 'EGP', canCheckout: entries.length > 0 && entries.every(item => item.status === 'available') };
  }
  async function save(store, owned, previous, items, timestamp, session) {
    if (items.length > 100 || items.some(item => item.quantity > 10000)) throw new AppError(409, 'CART_LIMIT_EXCEEDED');
    const expiresAt = owned.guest ? new Date(timestamp.getTime() + guestCartLifetimeMs) : null;
    const changed = previous ? await repository.replace(store, owned.ownerKey, previous.version, items, expiresAt, session)
      : await repository.create({ store, ownerKey: owned.ownerKey, items, expiresAt, version: 0 }, session);
    if (!changed) throw new AppError(409, 'CART_CONFLICT');
  }
  async function mutation(work) {
    try { return await transaction(work); }
    catch (error) {
      if (error.code === 11000) throw new AppError(409, 'CART_CONFLICT');
      throw error;
    }
  }
  return {
    async checkoutOwner(store, input, session = null) {
      const owned = await owner(store, input, session);
      return { ownerKey: owned.ownerKey, userId: owned.guest ? null : owned.ownerKey.slice(2) };
    },
    async consumeForOrder(store, input, session) {
      if (!session) throw new Error('Cart consumption requires the order transaction session.');
      const owned = await owner(store, input, session);
      await repository.remove(store, owned.ownerKey, session);
    },
    async getForCoupon(store, input, { session = null, locale = 'en', at = now() } = {}) {
      const owned = await owner(store, input, session);
      return present(store, lines(await repository.find(store, owned.ownerKey, session), at), session, locale, at);
    },
    async get(store, input, locale) {
      const timestamp = now();
      return mutation(async session => {
        const owned = await owner(store, input, session);
        await products.lockForCart(store, session);
        const previous = await repository.find(store, owned.ownerKey, session);
        if (!previous || (previous.expiresAt && new Date(previous.expiresAt) <= timestamp)) {
          await save(store, owned, previous, [], timestamp, session);
        }
        return present(store, lines(previous, timestamp), session, locale, timestamp);
      });
    },
    async setItem(store, input, data, locale) {
      const line = { productId: objectId(data.productId), variantId: data.variantId == null ? null : objectId(data.variantId), quantity: data.quantity };
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 10000) invalid();
      const timestamp = now();
      return mutation(async session => {
        const owned = await owner(store, input, session);
        // Share the catalog guard so product deletion/variant removal cannot race new cart references.
        await products.lockForCart(store, session);
        const previous = await repository.find(store, owned.ownerKey, session);
        const items = lines(previous, timestamp).filter(item => key(item) !== key(line));
        if (line.quantity) {
          const product = (await catalogue(store, [line], session, locale)).get(line.productId);
          if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
          if (product.type === 'simple' && line.variantId !== null) invalid();
          const item = sellable(product, line);
          if (!item) throw new AppError(409, 'CART_VARIANT_NOT_FOUND');
          if (line.quantity > item.stock) throw new AppError(409, 'CART_INSUFFICIENT_STOCK');
          items.push(line);
        }
        await save(store, owned, previous, items, timestamp, session);
        return present(store, items, session, locale);
      });
    },
    async clear(store, input, locale) {
      return mutation(async session => {
        const owned = await owner(store, input, session);
        await products.lockForCart(store, session);
        await repository.remove(store, owned.ownerKey, session);
        return present(store, [], session, locale);
      });
    },
    async merge(store, input, guestToken, locale) {
      if (!input?.identity) throw new AppError(401, 'UNAUTHORIZED');
      const sourceKey = guestKey(guestToken);
      const timestamp = now();
      return mutation(async session => {
        const owned = await owner(store, input, session);
        await products.lockForCart(store, session);
        const previous = await repository.find(store, owned.ownerKey, session);
        const source = await repository.find(store, sourceKey, session);
        const guestItems = lines(source, timestamp);
        const items = lines(previous, timestamp);
        if (guestItems.length) {
          const combined = new Map(items.map(item => [key(item), item]));
          for (const item of guestItems) {
            const existing = combined.get(key(item));
            combined.set(key(item), { ...item, quantity: item.quantity + (existing?.quantity ?? 0) });
          }
          const merged = [...combined.values()];
          if (merged.length > 100 || merged.some(item => item.quantity > 10000)) throw new AppError(409, 'CART_LIMIT_EXCEEDED');
          const preview = await present(store, merged, session, locale);
          if (!preview.canCheckout) throw new AppError(409, 'CART_MERGE_UNAVAILABLE');
          await save(store, owned, previous, merged, timestamp, session);
          await repository.remove(store, sourceKey, session);
          return preview;
        }
        if (source) await repository.remove(store, sourceKey, session);
        return present(store, items, session, locale);
      });
    },
    hasProductReferences(store, productId, variantIds, session) {
      checkStore(store);
      return repository.hasProductReferences(store, productId, variantIds, now(), session);
    },
  };
}
