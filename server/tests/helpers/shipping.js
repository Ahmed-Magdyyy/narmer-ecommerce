import { randomBytes } from 'node:crypto';
import { createShippingService } from '../../src/modules/shipping/shipping.service.js';

export function shippingFixture(auth) {
  const rows = new Map();
  const settings = new Map();
  const audits = [];
  const copy = value => value ? structuredClone(value) : null;
  let failAudit = false;
  let pending = Promise.resolve();
  const unique = data => {
    if ([...rows.values()].some(row => row.store === data.store && row.governorateCode === data.governorateCode)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
  };
  const repository = {
    async list(store, { page, limit }) {
      const sorted = [...rows.values()].filter(row => row.store === store).sort((a, b) => a.governorateCode.localeCompare(b.governorateCode));
      return [copy(sorted.slice((page - 1) * limit, page * limit)), sorted.length];
    },
    async findById(store, id) { return rows.get(String(id))?.store === store ? copy(rows.get(String(id))) : null; },
    async findByCode(store, code) { return copy([...rows.values()].find(row => row.store === store && row.governorateCode === code)); },
    async getDefault(store) { return copy(settings.get(store)); },
    async setDefault(store, defaultFee) { const value = { _id: store, defaultFee }; settings.set(store, value); return copy(value); },
    async create(data) { unique(data); const value = { _id: randomBytes(12).toString('hex'), ...copy(data) }; rows.set(value._id, value); return copy(value); },
    async update(store, id, fields) {
      const row = rows.get(String(id));
      if (!row || row.store !== store) return null;
      for (const [path, value] of Object.entries(fields)) {
        const [field, locale] = path.split('.');
        if (locale) row[field][locale] = value;
        else row[field] = value;
      }
      return copy(row);
    },
    async remove(store, id) { if (rows.get(String(id))?.store === store) rows.delete(String(id)); },
    async audit(data) { if (failAudit) throw new Error('audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => {
    const task = pending.then(async () => {
      const beforeRows = copy([...rows]);
      const beforeSettings = copy([...settings]);
      const beforeAudits = copy(audits);
      try { return await work({ testSession: true }); }
      catch (error) {
        for (const [map, values] of [[rows, beforeRows], [settings, beforeSettings]]) {
          map.clear(); for (const [id, row] of values) map.set(id, row);
        }
        audits.splice(0, audits.length, ...beforeAudits);
        throw error;
      }
    });
    pending = task.catch(() => {});
    return task;
  };
  return { rows, settings, audits, repository, transaction, shipping: createShippingService({ auth, repository, transaction }),
    failAudit(value) { failAudit = value; } };
}
