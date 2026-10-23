import { categoryFixture } from './categories.js';
import { createCategoriesService } from '../../src/modules/categories/categories.service.js';
import { createProductsService } from '../../src/modules/products/products.service.js';

export function productFixture(auth, { media = null, mediaRows = null } = {}) {
  const c = categoryFixture(auth);
  const rows = new Map();
  const audits = [];
  const references = new Set();
  const copy = value => structuredClone(value);
  let auditFailure = false;
  const unique = (data, exclude) => {
    for (const row of rows.values()) {
      if (row._id === exclude || row.store !== data.store) continue;
      const field = row.slug === data.slug ? 'slug' : row.skuKeys.some(sku => data.skuKeys.includes(sku)) ? 'skuKeys' : null;
      if (field) throw Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { [field]: 1 } });
    }
  };
  const repository = {
    async browseCandidates(store, { categoryIds, type }) {
      return copy([...rows.values()].filter(row => row.store === store && row.isActive
        && categoryIds.includes(row.categoryId) && (!type || row.type === type)))
        .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0) || b._id.localeCompare(a._id));
    },
    async adjustStock(store, id, variantId, quantity, restore) {
      const row = rows.get(id);
      const item = variantId ? row?.variants.find(variant => String(variant._id) === variantId) : row;
      if (!row || row.store !== store || !item || (variantId ? row.type !== 'variant' : row.type !== 'simple')
        || (restore ? item.stock > 1000000000 - quantity : item.stock < quantity)) return { matchedCount: 0 };
      item.stock += restore ? quantity : -quantity; row.version++;
      return { matchedCount: 1 };
    },
    async findById(store, id) { return rows.get(id)?.store === store ? copy(rows.get(id)) : null; },
    async findByIds(store, ids) { return copy([...rows.values()].filter(row => row.store === store && ids.includes(row._id))); },
    async create(data) { unique(data); rows.set(data._id, copy(data)); return copy(data); },
    async update(store, id, version, fields) {
      const previous = rows.get(id);
      if (!previous || previous.store !== store || previous.version !== version) return null;
      const next = { ...previous, ...copy(fields), version: version + 1 };
      unique(next, id);
      rows.set(id, next);
      return copy(next);
    },
    async remove(store, id) { if (rows.get(id)?.store === store) rows.delete(id); },
    async hasAssignedCategory(store, categoryId) { return [...rows.values()].some(row => row.store === store && String(row.categoryId) === String(categoryId)); },
    async hasSizeChartReferences(store, chartId) { return [...rows.values()].some(row => row.store === store && String(row.sizeChartId) === String(chartId)); },
    async countSizeChartAssignments(store, chartIds) {
      return chartIds.map(chartId => ({ _id: chartId, count: [...rows.values()].filter(row => row.store === store && String(row.sizeChartId) === chartId).length }));
    },
    async publicIds(store, categoryIds) { return [...rows.values()].filter(row => row.store === store && row.isActive && categoryIds.includes(row.categoryId)).map(row => row._id); },
    async list(store, { page, limit, categoryIds, isActive, type, q }) {
      const eligible = [...rows.values()].filter(row => row.store === store && (!categoryIds || categoryIds.includes(row.categoryId))
        && (isActive === undefined || row.isActive === isActive) && (!type || row.type === type)
        && (!q || [row.name.ar, row.name.en, row.slug].some(value => value.toLowerCase().includes(q.toLowerCase()))));
      return [copy(eligible.slice((page - 1) * limit, page * limit)), eligible.length];
    },
    async audit(data) { if (auditFailure) throw new Error('audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => c.transaction(async session => {
    const snapshot = copy([...rows]);
    const auditSnapshot = copy(audits);
    const mediaSnapshot = mediaRows ? copy([...mediaRows]) : null;
    try { return await work(session); }
    catch (error) {
      rows.clear();
      for (const [id, row] of snapshot) rows.set(id, row);
      audits.splice(0, audits.length, ...auditSnapshot);
      if (mediaRows) {
        mediaRows.clear();
        for (const [id, row] of mediaSnapshot) mediaRows.set(id, row);
      }
      throw error;
    }
  });
  let products;
  const categories = createCategoriesService({ auth, repository: c.repository, transaction, media,
    products: { hasAssignedCategory: (...args) => products.hasAssignedCategory(...args) } });
  products = createProductsService({ auth, categories, repository, transaction, media, references: {
    async hasProductReferences(store, productId, variantIds) {
      return references.has(productId) || variantIds?.some(id => references.has(id)) || false;
    },
  } });
  return { rows, audits, references, products, categories, repository, transaction, categoryRepository: c.repository,
    failAudit(value) { auditFailure = value; c.failAudit(value); } };
}

export const simpleInput = (categoryId, slug = 'shirt') => ({ type: 'simple', categoryId, slug,
  name: { ar: 'قميص', en: 'Shirt' }, price: 25000, stock: 10 });
export const variantInput = (categoryId, slug = 'variants') => ({ type: 'variant', categoryId, slug,
  name: { ar: 'قميص', en: 'Shirt' }, options: [{ key: 'size', name: { ar: 'المقاس', en: 'Size' },
    values: [{ key: 'small', name: { ar: 'صغير', en: 'Small' } }, { key: '42', name: { ar: '٤٢', en: '42' } }] }],
  variants: [{ values: { size: 'small' }, price: 25000, stock: 5 }, { values: { size: '42' }, price: 30000, stock: 2 }] });
