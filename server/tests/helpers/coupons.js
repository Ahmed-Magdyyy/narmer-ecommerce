import { randomBytes } from 'node:crypto';
import { createCouponsService } from '../../src/modules/coupons/coupons.service.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createCategoriesService } from '../../src/modules/categories/categories.service.js';
import { createCartService } from '../../src/modules/cart/cart.service.js';
import { testConfig } from './config.js';

export const emptyCouponsRepository = {
  async hasProductReferences() { return false; }, async hasCategoryReferences() { return false; },
};
export const couponInput = (fields = {}) => ({ code: 'WELCOME20', name: { ar: 'خصم ترحيبي', en: 'Welcome discount' },
  targetType: 'all', discountType: 'percentage', discountValue: 20, ...fields });

export function couponsFixture(auth, catalog) {
  const rows = new Map(), redemptions = [], audits = [];
  const copy = value => structuredClone(value);
  let clock = new Date('2026-10-11T12:00:00Z'), auditFailure = false, recordFailure = false;
  function unique(fields, except) {
    if ([...rows.values()].some(row => row._id !== except && row.store === fields.store && row.code === fields.code)) throw Object.assign(new Error('duplicate code'), { code: 11000 });
  }
  const repository = {
    async list(store, { page, limit, isEnabled, targetType }) {
      const filtered = [...rows.values()].filter(row => row.store === store && (isEnabled === undefined || row.isEnabled === isEnabled) && (!targetType || row.targetType === targetType));
      return [copy(filtered.slice((page - 1) * limit, page * limit)), filtered.length];
    },
    async findById(store, id) { return rows.get(String(id))?.store === store ? copy(rows.get(String(id))) : null; },
    async findByCode(store, code) { return copy([...rows.values()].find(row => row.store === store && row.code === code) ?? null); },
    async create(data) { unique(data); const row = { ...copy(data), _id: randomBytes(12).toString('hex') }; rows.set(row._id, row); return copy(row); },
    async update(store, id, fields) {
      const previous = rows.get(String(id)); if (!previous || previous.store !== store) return null;
      const next = { ...previous, ...copy(fields) }; unique(next, String(id)); rows.set(String(id), next); return copy(next);
    },
    async remove(store, id) { if (rows.get(String(id))?.store === store) rows.delete(String(id)); },
    async audit(data) { if (auditFailure) throw new Error('audit failed'); audits.push(copy(data)); },
    async hasProductReferences(store, productId) { return [...rows.values()].some(row => row.store === store && row.productIds.includes(productId)); },
    async hasCategoryReferences(store, categoryId) { return [...rows.values()].some(row => row.store === store && row.categoryId === categoryId); },
    async hasRedemptions(store, couponId) { return redemptions.some(row => row.store === store && String(row.couponId) === String(couponId)); },
    async countPersonUses(store, couponId, customerKeys) { return redemptions.filter(row => row.store === store && String(row.couponId) === String(couponId) && customerKeys.includes(row.customerKey)).length; },
    async findOrderRedemption(store, orderId) { return copy(redemptions.find(row => row.store === store && row.orderId === orderId) ?? null); },
    async incrementUsage(store, couponId, usedCount) {
      const row = rows.get(String(couponId)); if (!row || row.store !== store || row.usedCount !== usedCount) return null;
      row.usedCount++; return copy(row);
    },
    async recordRedemption(data) {
      if (recordFailure) throw new Error('record failed');
      if (redemptions.some(row => row.store === data.store && row.orderId === data.orderId)) throw Object.assign(new Error('duplicate order'), { code: 11000 });
      const row = { _id: randomBytes(12).toString('hex'), ...copy(data) }; redemptions.push(row); return copy(row);
    },
  };
  const transaction = work => catalog.transaction(async session => {
    const before = copy([...rows]), beforeRedemptions = copy(redemptions), beforeAudits = copy(audits);
    try { return await work(session); }
    catch (error) {
      rows.clear(); for (const [key, row] of before) rows.set(key, row);
      redemptions.splice(0, redemptions.length, ...beforeRedemptions); audits.splice(0, audits.length, ...beforeAudits); throw error;
    }
  });
  let coupons, products, cart;
  const categories = createCategoriesService({ auth, repository: catalog.categoryRepository, transaction, sales: catalog.sales,
    products: { hasAssignedCategory: (...args) => products.hasAssignedCategory(...args) },
    coupons: { hasCategoryReferences: (...args) => coupons.hasCategoryReferences(...args) } });
  products = createProductsService({ auth, categories, repository: catalog.repository, transaction, sales: catalog.sales,
    references: { async hasProductReferences(store, productId, variantIds, session) {
      return await cart.hasProductReferences(store, productId, variantIds, session)
        || (!variantIds && await repository.hasProductReferences(store, productId));
    } } });
  cart = createCartService({ auth, products, repository: catalog.cartRepository, transaction, now: () => new Date(clock) });
  coupons = createCouponsService({ auth, categories, products, cart, identitySecret: testConfig.couponIdentitySecret, repository, transaction, now: () => new Date(clock) });
  return { coupons, categories, products, cart, rows, redemptions, audits, repository, transaction, now: () => new Date(clock),
    at(value) { clock = new Date(value); }, failAudit(value) { auditFailure = value; }, failRecord(value) { recordFailure = value; } };
}
