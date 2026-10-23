import { productFixture } from './products.js';
import { mediaFixture } from './media.js';
import { salesFixture } from './sales.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createMediaService } from '../../src/modules/media/media.service.js';
import { createHomepageService } from '../../src/modules/homepage/homepage.service.js';
import { homepageSlots, homepageTargetId } from '../../src/modules/homepage/homepage.slots.js';

export const emptyHomepageRepository = { async hasProductReferences() { return false; } };
export function homepageFixture(auth) {
  const m = mediaFixture(), p = productFixture(auth), s = salesFixture(auth, p), rows = new Map(), audits = [];
  const copy = value => value == null ? null : structuredClone(value);
  let failAudit = false;
  const repository = {
    async find(store) { return copy(rows.get(store)); },
    async create(data) {
      if (rows.has(data._id)) throw Object.assign(new Error('duplicate homepage'), { code: 11000 });
      const row = { ...copy(data), createdAt: m.now(), updatedAt: m.now() }; rows.set(data._id, row); return copy(row);
    },
    async update(store, version, fields) {
      const previous = rows.get(store);
      if (!previous || previous.version !== version || version === Number.MAX_SAFE_INTEGER) return null;
      const row = { ...previous, ...copy(fields), version: version + 1, updatedAt: m.now() }; rows.set(store, row); return copy(row);
    },
    async audit(data) { if (failAudit) throw new Error('homepage audit failed'); audits.push(copy(data)); },
    async hasProductReferences(productId) {
      const row = rows.get('b2c'); return Boolean(row && [...row.newArrivals.productIds, ...row.sale.productIds].includes(productId));
    },
  };
  const transaction = work => s.transaction(async session => {
    const before = [rows, m.rows].map(map => copy([...map])), previousAudits = copy(audits);
    try { return await work(session); }
    catch (error) {
      [rows, m.rows].forEach((map, index) => { map.clear(); for (const [key, value] of before[index]) map.set(key, value); });
      audits.splice(0, audits.length, ...previousAudits); throw error;
    }
  });
  let homepage, products;
  const target = { async getStaff(store, identity, targetId) {
    const slot = homepageSlots(store).find(slot => homepageTargetId(store, slot.key) === targetId);
    if (!slot) throw new Error('invalid homepage target');
    return homepage.authorizeImage(store, identity, slot.key);
  } };
  const media = createMediaService({ auth, repository: m.repository, storage: m.storage, now: m.now,
    logger: { error() {} }, targets: { 'homepage-desktop': target, 'homepage-mobile': target } });
  products = createProductsService({ auth, categories: s.categories, repository: p.repository, transaction, sales: s.sales,
    references: { hasProductReferences: (store, id, variantIds) => !variantIds && repository.hasProductReferences(id) } });
  homepage = createHomepageService({ auth, products, media, repository, transaction });
  return { homepage, products, media, repository, transaction, rows, audits, p, m, s, failAudit(value) { failAudit = value; } };
}
