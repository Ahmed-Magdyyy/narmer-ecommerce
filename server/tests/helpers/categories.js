import { createCategoriesService } from '../../src/modules/categories/categories.service.js';

export function categoryFixture(auth) {
  const rows = new Map();
  const audits = [];
  const assigned = new Set();
  const copy = value => structuredClone(value);
  let auditFailure = false;
  let pending = Promise.resolve();
  const repository = {
    async lockTree() { return { revision: 1 }; },
    async all(store) {
      return copy([...rows.values()].filter(row => row.store === store)
        .sort((a, b) => a.position - b.position || a._id.localeCompare(b._id)));
    },
    async create(data) {
      if ([...rows.values()].some(row => row.store === data.store && row.slug === data.slug)) {
        throw Object.assign(new Error('duplicate'), { code: 11000 });
      }
      rows.set(data._id, copy(data));
      return copy(data);
    },
    async update(store, id, fields) {
      const row = rows.get(id);
      if (!row || row.store !== store) return null;
      if (fields.slug && [...rows.values()].some(item => item._id !== id && item.store === store && item.slug === fields.slug)) {
        throw Object.assign(new Error('duplicate'), { code: 11000 });
      }
      for (const [path, value] of Object.entries(fields)) {
        const [field, locale] = path.split('.');
        if (locale) row[field][locale] = copy(value);
        else row[field] = copy(value);
      }
      return copy(row);
    },
    async remove(store, id) {
      if (rows.get(id)?.store === store) rows.delete(id);
    },
    async audit(data) {
      if (auditFailure) throw new Error('audit failed');
      audits.push(copy(data));
    },
  };
  function transaction(work) {
    const operation = pending.then(async () => {
      const snapshot = copy([...rows]);
      const auditSnapshot = copy(audits);
      try { return await work({ testSession: true }); }
      catch (error) {
        rows.clear();
        for (const [id, row] of snapshot) rows.set(id, row);
        audits.splice(0, audits.length, ...auditSnapshot);
        throw error;
      }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  const categories = createCategoriesService({ auth, repository, transaction, products: {
    async hasAssignedCategory(store, id) { return assigned.has(`${store}:${id}`); },
  } });
  return { categories, repository, transaction, rows, audits, assigned,
    failAudit(value) { auditFailure = value; } };
}
