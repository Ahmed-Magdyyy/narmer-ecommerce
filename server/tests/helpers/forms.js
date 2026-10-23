import { randomBytes } from 'node:crypto';
import { createFormsService } from '../../src/modules/forms/forms.service.js';
import { formTypes, initialTitles } from '../../src/modules/forms/forms.definitions.js';

export function formsFixture(auth) {
  const rows = new Map(formTypes.map(type => [type, { _id: randomBytes(12).toString('hex'), store: 'b2b', type,
    title: structuredClone(initialTitles[type]), helpText: { ar: '', en: '' }, fields: [], isActive: false, version: 0 }]));
  const audits = [];
  const copy = value => structuredClone(value);
  let failure = false;
  let pending = Promise.resolve();
  const repository = {
    async list(store, publicOnly) { return copy([...rows.values()].filter(row => row.store === store && (!publicOnly || row.isActive))); },
    async find(store, type) { return copy(rows.get(type)?.store === store ? rows.get(type) : null); },
    async lockForSubmission(store, type, version) {
      const row = rows.get(type);
      if (!row || row.store !== store || row.version !== version || !row.isActive) return null;
      row.submissionRevision = (row.submissionRevision ?? 0) + 1; return copy(row);
    },
    async update(store, type, version, fields) {
      const row = rows.get(type);
      if (!row || row.store !== store || row.version !== version) return null;
      Object.assign(row, copy(fields), { version: version + 1 }); return copy(row);
    },
    async audit(data) { if (failure) throw new Error('form audit failed'); audits.push(copy(data)); },
  };
  function transaction(work) {
    const operation = pending.then(async () => {
      const snapshot = copy([...rows]), auditSnapshot = copy(audits);
      try { return await work({ testSession: true }); }
      catch (error) { rows.clear(); for (const [type, row] of snapshot) rows.set(type, row); audits.splice(0, audits.length, ...auditSnapshot); throw error; }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return { rows, audits, repository, transaction, forms: createFormsService({ auth, repository, transaction }),
    failAudit(value) { failure = value; } };
}
export const textField = (key = 'material-description') => ({ key, type: 'textarea',
  label: { ar: 'وصف الخامة', en: 'Material description' }, required: false });
export const choiceField = (type = 'select') => ({ key: 'material-type', type,
  label: { ar: 'نوع الخامة', en: 'Material type' }, required: true,
  choices: [{ key: 'cotton', label: { ar: 'قطن', en: 'Cotton' } }, { key: 'wool', label: { ar: 'صوف', en: 'Wool' } }] });
