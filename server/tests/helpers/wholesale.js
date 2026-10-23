import { productFixture } from './products.js';
import { mediaFixture } from './media.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createMediaService } from '../../src/modules/media/media.service.js';
import { createWholesaleService } from '../../src/modules/wholesale/wholesale.service.js';

export const emptyWholesaleRepository = { async hasProductReferences() { return false; } };
export const nativeInput = { name: { ar: 'منتج الجملة', en: 'Wholesale item' } };
export const offerInput = (sourceStore, productId, composition = [{ variantId: null, quantity: 30 }]) => ({
  name: { ar: 'عبوة الجملة', en: 'Wholesale pouch' }, sourceStore, productId, composition,
});
export function wholesaleFixture(auth) {
  const p = productFixture(auth), m = mediaFixture(), nativeRows = new Map(), offerRows = new Map(), audits = [];
  const copy = value => structuredClone(value), rows = resource => resource === 'product' ? nativeRows : offerRows;
  let failure = false;
  const repository = {
    async lock() {},
    async list(resource, store, input) {
      const selected = [...rows(resource).values()].filter(row => row.store === store
        && (input.isActive === undefined || input.isActive === row.isActive)
        && (!input.sourceStore || input.sourceStore === row.sourceStore)
        && (!input.productId || input.productId === row.productId)
        && (!input.q || [row.name.ar, row.name.en].some(value => value.toLowerCase().includes(input.q.toLowerCase())))
        && (!input.eligible || input.eligible[row.sourceStore].includes(row.productId)));
      return [copy(selected.slice((input.page - 1) * input.limit, input.page * input.limit)), selected.length];
    },
    async find(resource, store, id) { return copy(rows(resource).get(id)?.store === store ? rows(resource).get(id) : null); },
    async findProducts(store, ids) { return copy([...nativeRows.values()].filter(row => row.store === store && row.isActive && ids.includes(row._id))); },
    async publicProductIds(store) { return [...nativeRows.values()].filter(row => row.store === store && row.isActive).map(row => row._id); },
    async create(resource, data) { rows(resource).set(data._id, copy(data)); return copy(data); },
    async update(resource, store, id, version, fields) {
      const row = rows(resource).get(id);
      if (!row || row.store !== store || row.version !== version) return null;
      Object.assign(row, copy(fields), { version: version + 1 }); return copy(row);
    },
    async remove(resource, store, id) { if (rows(resource).get(id)?.store === store) rows(resource).delete(id); },
    async hasProductReferences(sourceStore, productId, variantIds) {
      return [...offerRows.values()].some(row => row.sourceStore === sourceStore && row.productId === productId
        && (!variantIds || row.composition.some(line => variantIds.includes(line.variantId))));
    },
    async audit(data) { if (failure) throw new Error('wholesale audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => p.transaction(async session => {
    const snapshot = [copy([...nativeRows]), copy([...offerRows]), copy(audits), copy([...m.rows])];
    try { return await work(session); }
    catch (error) { for (const [map, data] of [[nativeRows, snapshot[0]], [offerRows, snapshot[1]], [m.rows, snapshot[3]]]) {
      map.clear(); for (const [id, row] of data) map.set(id, row);
    } audits.splice(0, audits.length, ...snapshot[2]); throw error; }
  });
  let wholesale;
  const products = createProductsService({ auth, categories: p.categories, repository: p.repository, transaction,
    references: { hasProductReferences: (store, productId, variantIds, session) => wholesale.hasB2cReferences(productId, variantIds, session) } });
  const media = createMediaService({ auth, storage: m.storage, repository: m.repository, now: m.now,
    targets: { product: { getStaff: (store, ...args) => store === 'b2b' ? wholesale.getProduct(store, ...args) : products.getStaff(store, ...args) } } });
  wholesale = createWholesaleService({ auth, products, media, repository, transaction });
  return { ...p, products, wholesale, media, m, nativeRows, offerRows, wholesaleAudits: audits,
    wholesaleRepository: repository, transaction, failWholesaleAudit(value) { failure = value; } };
}
