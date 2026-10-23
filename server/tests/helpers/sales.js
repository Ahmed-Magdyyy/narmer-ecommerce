import { randomBytes } from 'node:crypto';
import { createSalesService } from '../../src/modules/sales/sales.service.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createCategoriesService } from '../../src/modules/categories/categories.service.js';

export const emptySalesRepository = {
  async enabled() { return []; }, async active() { return []; },
  async hasProductReferences() { return false; }, async hasCategoryReferences() { return false; },
};

export function salesFixture(auth, catalog) {
  const rows = new Map(), audits = [];
  const copy = value => structuredClone(value);
  let clock = new Date('2026-10-11T12:00:00Z');
  let auditFailure = false;
  const repository = {
    async enabled(store) { return copy([...rows.values()].filter(row => row.store === store && row.isEnabled)); },
    async active(store, at) { return (await this.enabled(store)).filter(row => row.startsAt <= at && row.endsAt > at); },
    async hasProductReferences(store, productId) { return [...rows.values()].some(row => row.store === store && row.productIds.includes(productId)); },
    async hasCategoryReferences(store, categoryId) { return [...rows.values()].some(row => row.store === store && row.categoryId === categoryId); },
    async list(store, { page, limit, isEnabled, targetType }) {
      const items = [...rows.values()].filter(row => row.store === store && (isEnabled === undefined || row.isEnabled === isEnabled)
        && (!targetType || row.targetType === targetType));
      return [copy(items.slice((page - 1) * limit, page * limit)), items.length];
    },
    async findById(store, id) { return rows.get(String(id))?.store === store ? copy(rows.get(String(id))) : null; },
    async create(data) { const row = { _id: randomBytes(12).toString('hex'), ...copy(data) }; rows.set(row._id, row); return copy(row); },
    async update(store, id, fields) {
      const previous = rows.get(String(id));
      if (!previous || previous.store !== store) return null;
      const row = { ...previous, ...copy(fields) }; rows.set(String(id), row); return copy(row);
    },
    async remove(store, id) { if (rows.get(String(id))?.store === store) rows.delete(String(id)); },
    async audit(data) { if (auditFailure) throw new Error('audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => catalog.transaction(async session => {
    const before = copy([...rows]), beforeAudits = copy(audits);
    try { return await work(session); }
    catch (error) {
      rows.clear(); for (const [key, row] of before) rows.set(key, row);
      audits.splice(0, audits.length, ...beforeAudits); throw error;
    }
  });
  const sales = createSalesService({ auth, categories: catalog.categories,
    products: catalog.products, repository, transaction, now: () => new Date(clock) });
  const categories = createCategoriesService({ auth, repository: catalog.categoryRepository, transaction, sales,
    products: catalog.products });
  const products = createProductsService({ auth, categories, repository: catalog.repository, transaction, sales, now: () => new Date(clock),
    references: { hasProductReferences: (store, productId, variantIds) => !variantIds && repository.hasProductReferences(store, productId) } });
  return { sales, products, categories, rows, audits, repository, transaction, now: () => new Date(clock),
    at(value) { clock = new Date(value); }, failAudit(value) { auditFailure = value; } };
}

export const saleInput = productId => ({ name: { ar: 'تخفيضات', en: 'Sale' }, targetType: 'products', productIds: [productId],
  discountType: 'percentage', discountValue: 20, startsAt: '2026-10-11T12:00:00Z', endsAt: '2026-10-12T12:00:00Z' });
