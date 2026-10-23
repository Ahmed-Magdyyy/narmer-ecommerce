import { productFixture } from './products.js';
import { mediaFixture } from './media.js';
import { createMediaService } from '../../src/modules/media/media.service.js';
import { createProductsService } from '../../src/modules/products/products.service.js';
import { createSizechartsService } from '../../src/modules/sizecharts/sizecharts.service.js';

export function sizechartsFixture(auth) {
  const p = productFixture(auth), m = mediaFixture();
  const rows = new Map(), audits = [], copy = value => structuredClone(value);
  let failAudit = false;
  const repository = {
    async findById(store, id) { return rows.get(id)?.store === store ? copy(rows.get(id)) : null; },
    async publicByIds(store, ids) { return copy([...rows.values()].filter(row => row.store === store && row.isActive && ids.includes(row._id))); },
    async list(store, { page, limit, isActive }) {
      const matching = [...rows.values()].filter(row => row.store === store && (isActive === undefined || row.isActive === isActive))
        .sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
      return [copy(matching.slice((page - 1) * limit, page * limit)), matching.length];
    },
    async create(data) { const row = { ...copy(data), createdAt: m.now(), updatedAt: m.now() }; rows.set(row._id, row); return copy(row); },
    async update(store, id, version, fields) {
      const previous = rows.get(id);
      if (!previous || previous.store !== store || previous.version !== version || version === Number.MAX_SAFE_INTEGER) return null;
      const row = { ...previous, ...copy(fields), version: version + 1, updatedAt: m.now() }; rows.set(id, row); return copy(row);
    },
    async remove(store, id) { if (rows.get(id)?.store === store) rows.delete(id); },
    async audit(data) { if (failAudit) throw new Error('chart audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => p.transaction(async session => {
    const snapshots = [rows, m.rows].map(map => copy([...map])), previousAudits = copy(audits);
    try { return await work(session); }
    catch (error) {
      [rows, m.rows].forEach((map, index) => { map.clear(); for (const [key, value] of snapshots[index]) map.set(key, value); });
      audits.splice(0, audits.length, ...previousAudits); throw error;
    }
  });
  let charts, products;
  const chartTarget = { getStaff: (...args) => charts.getStaff(...args) };
  const media = createMediaService({ auth, storage: m.storage, repository: m.repository, now: m.now,
    logger: { error() {} }, targets: { 'size-chart-en': chartTarget, 'size-chart-ar': chartTarget,
      product: { getStaff: (...args) => products.getStaff(...args) } } });
  products = createProductsService({ auth, categories: p.categories, repository: p.repository, transaction, media,
    sizeCharts: { validateAssignment: (...args) => charts.validateAssignment(...args), publicForProducts: (...args) => charts.publicForProducts(...args) } });
  charts = createSizechartsService({ auth, categories: p.categories, products, media, repository, transaction });
  return { charts, products, media, m, p, rows, audits, repository, transaction, failAudit(value) { failAudit = value; } };
}

export const chartInput = { name: { en: 'Shirt sizes', ar: 'مقاسات القمصان' } };
export const measurementInput = { unit: 'cm', rows: [
  { size: ' S ', chest: 50.25, length: 66, sleeve: 60 },
  { size: 'M', chest: 53, length: 69, sleeve: 62 },
] };
