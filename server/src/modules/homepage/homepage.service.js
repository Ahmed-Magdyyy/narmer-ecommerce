import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { homepageRepository } from './homepage.repository.js';
import { homepageSlots, homepageTargetId } from './homepage.slots.js';

const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const checkStore = store => { if (!['b2c', 'b2b'].includes(store)) throw new AppError(400, 'INVALID_STORE'); };
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length
    || Object.keys(value).some(key => !keys.includes(key))) invalid();
};
const imageId = value => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid();
  return value.toLowerCase();
};
const discounted = product => (product.type === 'simple' ? [product] : product.variants)
  .some(item => item.effectivePrice < item.price);
function defaults(store) {
  return { _id: store, version: 0, slots: homepageSlots(store).map(({ key }) => ({ key,
    desktopImage: null, mobileImage: null, alt: { en: '', ar: '' } })),
  newArrivals: { productIds: [] }, sale: { productIds: [] }, updatedAt: null };
}
function selection(value) {
  object(value, ['productIds']);
  if (!Array.isArray(value.productIds) || value.productIds.length > 20) invalid();
  const ids = value.productIds.map(value => { const id = imageId(value); if (!id) invalid(); return id; });
  if (new Set(ids).size !== ids.length) invalid();
  return { productIds: ids };
}
export function createHomepageService({ auth, products, media, repository = homepageRepository, transaction = runTransaction }) {
  async function view(row, locale) {
    const store = row._id, isPublic = Boolean(locale), defs = homepageSlots(store);
    const result = { store, ...(isPublic ? {} : { version: row.version, allowedSlots: defs }),
      slots: row.slots.map(slot => ({ key: slot.key, desktopImage: slot.desktopImage, mobileImage: slot.mobileImage,
        alt: isPublic ? slot.alt[locale] || slot.alt[locale === 'ar' ? 'en' : 'ar'] : { ...slot.alt } })),
      updatedAt: row.updatedAt?.toISOString() ?? null };
    if (store === 'b2c') {
      const ids = [...new Set([...row.newArrivals.productIds, ...row.sale.productIds].map(String))];
      const items = ids.length ? await products.getForHomepage(ids, locale ?? 'en') : [];
      const byId = new Map(items.map(product => [product.id, product]));
      for (const section of ['newArrivals', 'sale']) {
        const productIds = row[section].productIds.map(String);
        const visible = productIds.map(id => byId.get(id)).filter(product => product && (section !== 'sale' || discounted(product)));
        result[section] = isPublic ? { items: visible } : { productIds, visibleProductIds: visible.map(product => product.id) };
      }
    }
    return result;
  }
  return {
    async getPublic(store, locale = 'en') { checkStore(store); return view(await repository.find(store) ?? defaults(store), locale); },
    async getStaff(store, identity) {
      checkStore(store); await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      return view(await repository.find(store) ?? defaults(store));
    },
    async authorizeImage(store, identity, slotKey) {
      checkStore(store); await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      if (!homepageSlots(store).some(slot => slot.key === slotKey)) invalid();
    },
    async upload(store, identity, slotKey, device, buffer, contentType) {
      await this.authorizeImage(store, identity, slotKey);
      if (!['desktop', 'mobile'].includes(device)) invalid();
      return media.upload(store, identity, `homepage-${device}`, homepageTargetId(store, slotKey), buffer, contentType);
    },
    async update(store, identity, input) {
      checkStore(store);
      try {
        const saved = await transaction(async session => {
          const actor = await auth.authorizeStaff(store, identity, ['superAdmin', 'admin'], session);
          object(input, store === 'b2c' ? ['version', 'slots', 'newArrivals', 'sale'] : ['version', 'slots']);
          if (!Number.isSafeInteger(input.version) || input.version < 0 || Object.keys(input).length < 2) invalid();
          if (store === 'b2c') await products.lockForCart(store, session);
          const previous = await repository.find(store, session) ?? defaults(store);
          if (input.version !== previous.version || previous.version === Number.MAX_SAFE_INTEGER) throw new AppError(409, 'HOMEPAGE_CONFLICT');
          const fields = { slots: structuredClone(previous.slots), newArrivals: previous.newArrivals, sale: previous.sale };
          const retired = [];
          if (Object.hasOwn(input, 'slots')) {
            if (!Array.isArray(input.slots) || !input.slots.length || input.slots.length > previous.slots.length) invalid();
            const seen = new Set();
            for (const patch of input.slots) {
              object(patch, ['key', 'desktopImageId', 'mobileImageId', 'alt']);
              const slot = fields.slots.find(slot => slot.key === patch.key);
              if (!slot || seen.has(patch.key) || Object.keys(patch).length < 2) invalid();
              seen.add(patch.key);
              if (Object.hasOwn(patch, 'alt')) {
                object(patch.alt, ['en', 'ar']);
                for (const [language, value] of Object.entries(patch.alt)) {
                  if (typeof value !== 'string' || value.trim().length > 500) invalid();
                  slot.alt[language] = value.trim();
                }
              }
              for (const device of ['desktop', 'mobile']) if (Object.hasOwn(patch, `${device}ImageId`)) {
                const requested = imageId(patch[`${device}ImageId`]), old = slot[`${device}Image`];
                const kind = `homepage-${device}`, targetId = homepageTargetId(store, slot.key);
                const images = await media.replace(store, kind, targetId, requested ? [requested] : [], old ? [old.id] : [], session);
                slot[`${device}Image`] = requested ? images.get(requested) : null;
                if (old && old.id !== requested) retired.push({ kind, targetId });
              }
            }
          }
          for (const section of ['newArrivals', 'sale']) if (Object.hasOwn(input, section)) {
            fields[section] = selection(input[section]);
            const existing = await products.getCatalogReferences('b2c', fields[section].productIds, { session });
            if (existing.length !== fields[section].productIds.length) throw new AppError(409, 'HOMEPAGE_PRODUCT_UNAVAILABLE');
          }
          const row = previous.updatedAt === null ? await repository.create({ _id: store, ...fields, version: 1 }, session)
            : await repository.update(store, previous.version, fields, session);
          if (!row) throw new AppError(409, 'HOMEPAGE_CONFLICT');
          await repository.audit({ store, actorId: actor._id, version: row.version, fields: Object.keys(input).filter(key => key !== 'version') }, session);
          return { row, retired };
        });
        for (const target of saved.retired) await media.cleanupTarget(store, target.kind, target.targetId);
        return view(saved.row);
      } catch (error) {
        if (error.code === 11000) throw new AppError(409, 'HOMEPAGE_CONFLICT');
        throw error;
      }
    },
    hasProductReferences: (productId, session) => repository.hasProductReferences(productId, session),
  };
}
