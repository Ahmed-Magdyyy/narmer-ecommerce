import { createSitesettingsService } from '../../src/modules/sitesettings/sitesettings.service.js';

export function sitesettingsFixture(auth) {
  const rows = new Map(), audits = [], copy = value => value == null ? null : structuredClone(value);
  let failAudit = false, pending = Promise.resolve();
  const repository = {
    async find(store) { return copy(rows.get(store)); },
    async create(data) {
      if (rows.has(data._id)) throw Object.assign(new Error('duplicate singleton'), { code: 11000 });
      const row = { ...copy(data), createdAt: new Date(), updatedAt: new Date() }; rows.set(data._id, row); return copy(row);
    },
    async update(store, version, fields) {
      const previous = rows.get(store);
      if (!previous || previous.version !== version || version === Number.MAX_SAFE_INTEGER) return null;
      const row = { ...previous, ...copy(fields), version: version + 1, updatedAt: new Date() }; rows.set(store, row); return copy(row);
    },
    async audit(data) { if (failAudit) throw new Error('settings audit failed'); audits.push(copy(data)); },
  };
  const transaction = work => {
    const result = pending.then(async () => {
      const previousRows = copy([...rows]), previousAudits = copy(audits);
      try { return await work({ testSession: true }); }
      catch (error) {
        rows.clear(); for (const [store, value] of previousRows) rows.set(store, value);
        audits.splice(0, audits.length, ...previousAudits); throw error;
      }
    });
    pending = result.catch(() => {}); return result;
  };
  return { settings: createSitesettingsService({ auth, repository, transaction }), rows, audits, repository, transaction,
    failAudit(value) { failAudit = value; } };
}

export const settingsInput = { version: 0, phone: '+20 (100) 123-4567', email: ' INFO@EXAMPLE.TEST ',
  address: { en: 'Example address', ar: 'عنوان تجريبي' }, mapUrl: 'https://www.google.com/maps?q=Cairo',
  social: { instagramUrl: 'https://www.instagram.com/example/', whatsappUrl: 'https://wa.me/201001234567',
    tiktokUrl: 'https://www.tiktok.com/@example', facebookUrl: 'https://www.facebook.com/example' },
  seo: { title: { en: 'Narmer clothing', ar: 'نارمر للملابس' }, description: { en: 'Example shop description', ar: 'وصف تجريبي' }, keywords: 'clothing, cotton' } };
