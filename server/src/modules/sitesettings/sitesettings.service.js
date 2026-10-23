import { AppError } from '../../shared/errors/app-error.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { sitesettingsRepository } from './sitesettings.repository.js';

const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const checkStore = store => { if (!['b2c', 'b2b'].includes(store)) throw new AppError(400, 'INVALID_STORE'); };
const object = (input, keys) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length
    || Object.keys(input).some(key => !keys.includes(key))) invalid();
};
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) invalid();
  return value.trim();
};
const translations = (input, previous, max, required = false) => {
  object(input, ['en', 'ar']);
  return Object.fromEntries(['en', 'ar'].map(language => [language, Object.hasOwn(input, language)
    ? text(input[language], max, required) : previous[language]]));
};
const socialHosts = {
  instagramUrl: ['instagram.com', 'www.instagram.com'],
  whatsappUrl: ['wa.me', 'whatsapp.com', 'www.whatsapp.com', 'api.whatsapp.com', 'chat.whatsapp.com'],
  tiktokUrl: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  facebookUrl: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com', 'fb.me'],
};
function link(value, key) {
  if (value === null) return null;
  const input = text(value, 2048);
  if (!input) return null;
  if (!/^https:\/\//i.test(input) || /[\s\\\u0000-\u001f\u007f]/.test(input)) invalid();
  let url;
  try { url = new URL(input); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) invalid();
  if (key === 'mapUrl') {
    const maps = ['maps.google.com', 'maps.app.goo.gl', 'maps.apple.com'].includes(url.hostname)
      || ['google.com', 'www.google.com', 'google.com.eg', 'www.google.com.eg', 'goo.gl'].includes(url.hostname)
        && /^\/maps(?:\/|$)/.test(url.pathname);
    if (!maps) invalid();
  } else if (!socialHosts[key]?.includes(url.hostname)) invalid();
  if (url.href.length > 2048) invalid();
  return url.href;
}
function defaults(store) {
  return { _id: store, version: 0, phone: null, email: null, address: { en: '', ar: '' }, mapUrl: null,
    social: { instagramUrl: null, whatsappUrl: null, tiktokUrl: null, facebookUrl: null },
    seo: { title: { en: 'Narmer', ar: 'نارمر' }, description: { en: '', ar: '' }, keywords: '' }, updatedAt: null };
}
function view(row, locale) {
  const local = value => locale ? value[locale] || value[locale === 'ar' ? 'en' : 'ar'] : { ...value };
  return { store: row._id, ...(locale ? {} : { version: row.version }), phone: row.phone, email: row.email,
    address: local(row.address), mapUrl: row.mapUrl, social: { ...row.social },
    seo: { title: local(row.seo.title), description: local(row.seo.description), keywords: row.seo.keywords },
    updatedAt: row.updatedAt?.toISOString() ?? null };
}
function build(input, previous) {
  object(input, ['version', 'phone', 'email', 'address', 'mapUrl', 'social', 'seo']);
  if (!Number.isSafeInteger(input.version) || input.version < 0 || Object.keys(input).length < 2) invalid();
  const fields = { phone: previous.phone, email: previous.email, address: { ...previous.address }, mapUrl: previous.mapUrl,
    social: { ...previous.social }, seo: { title: { ...previous.seo.title }, description: { ...previous.seo.description }, keywords: previous.seo.keywords } };
  if (Object.hasOwn(input, 'phone')) {
    fields.phone = input.phone === null ? null : normalizePhone(text(input.phone, 100));
    if (fields.phone !== null && !validPhone(fields.phone)) invalid();
  }
  if (Object.hasOwn(input, 'email')) {
    fields.email = input.email === null ? null : text(input.email, 254).toLowerCase();
    if (fields.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) invalid();
  }
  if (Object.hasOwn(input, 'address')) fields.address = translations(input.address, previous.address, 1000);
  if (Object.hasOwn(input, 'mapUrl')) fields.mapUrl = link(input.mapUrl, 'mapUrl');
  if (Object.hasOwn(input, 'social')) {
    object(input.social, Object.keys(socialHosts));
    for (const [key, value] of Object.entries(input.social)) fields.social[key] = link(value, key);
  }
  if (Object.hasOwn(input, 'seo')) {
    object(input.seo, ['title', 'description', 'keywords']);
    for (const key of ['title', 'description']) if (Object.hasOwn(input.seo, key)) {
      fields.seo[key] = translations(input.seo[key], previous.seo[key], key === 'title' ? 200 : 500, key === 'title');
    }
    if (Object.hasOwn(input.seo, 'keywords')) fields.seo.keywords = text(input.seo.keywords, 1000);
  }
  return fields;
}

export function createSitesettingsService({ auth, repository = sitesettingsRepository, transaction = runTransaction }) {
  return {
    async getPublic(store, locale = 'en') { checkStore(store); return view(await repository.find(store) ?? defaults(store), locale); },
    async getStaff(store, identity) {
      checkStore(store); await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      return view(await repository.find(store) ?? defaults(store));
    },
    async update(store, identity, input) {
      checkStore(store);
      try {
        return await transaction(async session => {
          const actor = await auth.authorizeStaff(store, identity, ['superAdmin', 'admin'], session);
          const stored = await repository.find(store, session), previous = stored ?? defaults(store);
          const fields = build(input, previous);
          if (input.version !== previous.version || previous.version === Number.MAX_SAFE_INTEGER) throw new AppError(409, 'SITE_SETTINGS_CONFLICT');
          const changed = stored ? await repository.update(store, previous.version, fields, session)
            : await repository.create({ _id: store, ...fields, version: 1 }, session);
          if (!changed) throw new AppError(409, 'SITE_SETTINGS_CONFLICT');
          await repository.audit({ store, actorId: actor._id, version: changed.version,
            fields: Object.keys(input).filter(key => key !== 'version') }, session);
          return view(changed);
        });
      } catch (error) {
        if (error.code === 11000) throw new AppError(409, 'SITE_SETTINGS_CONFLICT');
        throw error;
      }
    },
  };
}
