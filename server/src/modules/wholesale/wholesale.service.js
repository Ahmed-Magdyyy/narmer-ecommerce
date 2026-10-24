import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { wholesaleRepository } from './wholesale.repository.js';
import { isOfferSlug, legacyOfferIdPattern, offerSlugBase, offerSlugCandidate } from './wholesale.slug.js';

const invalid = () => { throw new AppError(422, 'INVALID_WHOLESALE'); };
const id = value => { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid(); return value.toLowerCase(); };
const local = (value, locale) => locale ? (value[locale] || value[locale === 'ar' ? 'en' : 'ar']) : { ...value };
function bilingual(input, previous, required, max) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['ar', 'en'].includes(key)))) invalid();
  return Object.fromEntries(['ar', 'en'].map(locale => {
    const value = input && Object.hasOwn(input, locale) ? input[locale] : (previous?.[locale] ?? (required ? undefined : ''));
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid();
    return [locale, value.trim()];
  }));
}
const nativeProjection = (row, locale) => ({ id: String(row._id), type: 'simple', name: local(row.name, locale),
  description: local(row.description, locale), images: row.images, options: [], variants: [] });
const productView = row => ({ ...nativeProjection(row), isActive: row.isActive, version: row.version });
const lines = input => {
  if (!Array.isArray(input) || !input.length || input.length > 100) invalid();
  const used = new Set();
  return input.map(line => {
    if (!line || typeof line !== 'object' || Array.isArray(line)
      || Object.keys(line).some(key => !['variantId', 'quantity'].includes(key))
      || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) invalid();
    const variantId = line.variantId == null ? null : id(line.variantId);
    if (used.has(variantId)) invalid(); used.add(variantId);
    return { variantId, quantity: line.quantity };
  });
};
const compositionValid = (product, composition) => product && (product.type === 'simple'
  ? composition.length === 1 && composition[0].variantId === null
  : composition.every(line => line.variantId && product.variants.some(variant => variant.id === line.variantId)));

export function createWholesaleService({ auth, products, media, repository = wholesaleRepository,
  transaction = runTransaction, references = null }) {
  function checkStore(store) { if (store !== 'b2b') throw new AppError(400, 'INVALID_STORE'); }
  const staff = (store, identity, session, deletion = false) => auth.authorizeStaff(store, identity,
    deletion ? ['superAdmin'] : ['superAdmin', 'admin'], session);
  async function sources(rows, locale, session = null) {
    const sourceIds = sourceStore => [...new Set(rows.filter(row => row.sourceStore === sourceStore).map(row => String(row.productId)))];
    const b2c = await products.getForWholesale(sourceIds('b2c'), { locale, session });
    const b2b = (await repository.findProducts('b2b', sourceIds('b2b'), session)).map(row => nativeProjection(row, locale));
    return new Map([...b2c.map(row => [`b2c:${row.id}`, row]), ...b2b.map(row => [`b2b:${row.id}`, row])]);
  }
  async function offerViews(rows, locale, session = null, includeUrls = true) {
    const catalog = await sources(rows, locale, session);
    return rows.map(row => {
      const composition = row.composition.map(line => ({ variantId: line.variantId ? String(line.variantId) : null, quantity: line.quantity }));
      const product = catalog.get(`${row.sourceStore}:${row.productId}`) ?? null;
      const isAvailable = Boolean(row.isActive && compositionValid(product, composition));
      if (includeUrls && (!locale || isAvailable) && (!isOfferSlug(row.slug) || !Array.isArray(row.slugAliases))) throw new AppError(503, 'NOT_READY');
      return { id: String(row._id), ...(includeUrls ? { slug: row.slug, slugAliases: [...(row.slugAliases ?? [])] } : {}),
        name: local(row.name, locale), description: local(row.description, locale),
        sourceStore: row.sourceStore, productId: String(row.productId), composition,
        piecesPerPouch: composition.reduce((sum, line) => sum + line.quantity, 0),
        isActive: row.isActive, isAvailable, product,
        version: row.version };
    });
  }
  async function offerUrlFields(store, resourceId, input, previous, name, session) {
    if (Object.hasOwn(input, 'slugAliases') || (!previous && Object.hasOwn(input, 'slug'))) invalid();
    if (previous) {
      if (!isOfferSlug(previous.slug) || !Array.isArray(previous.slugAliases)) throw new AppError(503, 'NOT_READY');
      if (!Object.hasOwn(input, 'slug')) return { slug: previous.slug, slugAliases: previous.slugAliases };
      if (typeof input.slug !== 'string' || !isOfferSlug(input.slug.trim())) invalid();
      const slug = input.slug.trim();
      if (slug === previous.slug) return { slug, slugAliases: previous.slugAliases };
      if (await repository.findOfferKey(store, slug, session)) throw new AppError(409, 'WHOLESALE_SLUG_EXISTS');
      await repository.reserveOfferKey(store, slug, resourceId, session);
      return { slug, slugAliases: [...previous.slugAliases, previous.slug] };
    }
    const base = offerSlugBase(name.en);
    let number = 1, slug = base;
    while (await repository.findOfferKey(store, slug, session)) slug = offerSlugCandidate(base, ++number);
    await repository.reserveOfferKey(store, slug, resourceId, session);
    return { slug, slugAliases: [] };
  }
  async function list(resource, store, identity, input, locale) {
    checkStore(store);
    if (identity) await staff(store, identity);
    const selected = { ...input, page: input.page ?? 1, limit: input.limit ?? 20 };
    if (!identity) {
      selected.isActive = true;
      selected.eligible = { b2c: await products.getWholesaleProductIds(), b2b: await repository.publicProductIds(store) };
    }
    const [rows, total] = await repository.list(resource, store, selected);
    const items = resource === 'product' ? rows.map(productView) : await offerViews(rows, locale);
    return { items: identity ? items : items.filter(item => item.isAvailable),
      pagination: { page: selected.page, limit: selected.limit, total, pages: Math.ceil(total / selected.limit) } };
  }
  async function item(resource, store, identity, resourceId, locale) {
    checkStore(store); resourceId = id(resourceId);
    if (identity) await staff(store, identity);
    const row = await repository.find(resource, store, resourceId);
    if (!row) throw new AppError(404, resource === 'product' ? 'WHOLESALE_PRODUCT_NOT_FOUND' : 'WHOLESALE_OFFER_NOT_FOUND');
    if (resource === 'product') return productView(row);
    const result = (await offerViews([row], locale))[0];
    if (!identity && !result.isAvailable) throw new AppError(404, 'WHOLESALE_OFFER_NOT_FOUND');
    return result;
  }
  async function mutate(resource, store, identity, action, resourceId, input) {
    checkStore(store); resourceId = id(resourceId);
    let cleanup = false;
    const result = await transaction(async session => {
      const actor = await staff(store, identity, session, action === 'deleted');
      // Always lock B2C before B2B when a mutation touches both catalogues.
      if (resource === 'offer') await products.lockForCart('b2c', session);
      await repository.lock(session);
      const previous = action === 'created' ? null : await repository.find(resource, store, resourceId, session);
      if (action !== 'created' && !previous) throw new AppError(404, resource === 'product' ? 'WHOLESALE_PRODUCT_NOT_FOUND' : 'WHOLESALE_OFFER_NOT_FOUND');
      if (action === 'updated' && input.version !== previous.version) throw new AppError(409, 'WHOLESALE_CONFLICT');
      if (Object.keys(input).some(key => ['price', 'stock', 'discountedPrice', 'sku', 'options', 'variants', 'categoryId', 'type'].includes(key))) invalid();
      let changed;
      const permitted = resource === 'product' ? ['name', 'description', 'isActive', 'imageIds'] : ['name', 'description', 'isActive', 'sourceStore', 'productId', 'composition', 'slug'];
      const selectedFields = Object.keys(input).filter(key => permitted.includes(key));
      if (action === 'updated' && !selectedFields.length) invalid();
      if (action === 'deleted') {
        const referenced = resource === 'product' ? await repository.hasProductReferences('b2b', resourceId, null, session)
          : references && await references.hasOfferReferences(resourceId, session);
        if (referenced) throw new AppError(409, 'WHOLESALE_REFERENCED');
        if (resource === 'product' && previous.images.length) {
          await media.replace(store, 'product', resourceId, [], previous.images.map(image => image.id), session);
          cleanup = true;
        }
        await repository.remove(resource, store, resourceId, session);
      } else {
        if (Object.hasOwn(input, 'isActive') && typeof input.isActive !== 'boolean') invalid();
        const fields = { name: bilingual(input.name, previous?.name, true, 200),
          description: bilingual(input.description, previous?.description, false, 10000),
          isActive: input.isActive ?? previous?.isActive ?? (resource === 'product') };
        if (typeof fields.isActive !== 'boolean') invalid();
        if (resource === 'product') {
          const imageIds = input.imageIds === undefined ? (previous?.images ?? []).map(image => image.id) : input.imageIds;
          if (!Array.isArray(imageIds) || imageIds.length > 10) invalid();
          const normalized = imageIds.map(id);
          if (new Set(normalized).size !== normalized.length) invalid();
          const oldImages = (previous?.images ?? []).map(image => image.id);
          const resolved = normalized.length || oldImages.length
            ? await media.replace(store, 'product', resourceId, normalized, oldImages, session) : new Map();
          fields.images = normalized.map(imageId => resolved.get(imageId));
          cleanup = oldImages.some(imageId => !normalized.includes(imageId));
        } else {
          const sourceStore = input.sourceStore === undefined ? previous?.sourceStore : input.sourceStore;
          const productId = id(input.productId === undefined ? String(previous?.productId ?? '') : input.productId);
          if (!['b2c', 'b2b'].includes(sourceStore)) invalid();
          if (previous && (sourceStore !== previous.sourceStore || productId !== String(previous.productId))) throw new AppError(409, 'WHOLESALE_SOURCE_IMMUTABLE');
          const composition = lines(input.composition === undefined ? previous?.composition.map(line => ({ variantId: line.variantId ? String(line.variantId) : null, quantity: line.quantity })) : input.composition);
          const source = (await sources([{ sourceStore, productId }], undefined, session)).get(`${sourceStore}:${productId}`);
          if (!source && (action === 'created' || input.composition !== undefined || input.isActive === true)) throw new AppError(409, 'WHOLESALE_SOURCE_UNAVAILABLE');
          if (source && !compositionValid(source, composition)) invalid();
          Object.assign(fields, { composition, ...(previous ? {} : { sourceStore, productId }) });
          Object.assign(fields, await offerUrlFields(store, resourceId, input, previous, fields.name, session));
        }
        changed = previous ? await repository.update(resource, store, resourceId, previous.version, fields, session)
          : await repository.create(resource, { _id: resourceId, store, ...fields, version: 0 }, session);
        if (!changed) throw new AppError(409, 'WHOLESALE_CONFLICT');
      }
      await repository.audit({ store, actorId: actor._id, resource, resourceId, action, fields: selectedFields }, session);
      return changed ? (resource === 'product' ? productView(changed) : (await offerViews([changed], undefined, session))[0]) : null;
    });
    if (cleanup) await media.cleanupTarget(store, 'product', resourceId);
    return result;
  }
  return {
    async getForSubmission(store, requests, session) {
      checkStore(store);
      if (!session) throw new Error('Wholesale submission requires a transaction session.');
      if (!Array.isArray(requests) || !requests.length || requests.length > 10) invalid();
      await products.lockForCart('b2c', session);
      await repository.lock(session);
      const rows = [], seen = new Set();
      for (const request of requests) {
        const offerId = id(request.offerId);
        if (seen.has(offerId) || !Number.isSafeInteger(request.version) || request.version < 0
          || !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 10000) invalid();
        seen.add(offerId);
        const row = await repository.find('offer', store, offerId, session);
        if (!row || !row.isActive) throw new AppError(409, 'WHOLESALE_SOURCE_UNAVAILABLE');
        if (row.version !== request.version) throw new AppError(409, 'WHOLESALE_CONFLICT');
        rows.push(row);
      }
      const offers = await offerViews(rows, undefined, session, false);
      if (offers.some(offer => !offer.isAvailable)) throw new AppError(409, 'WHOLESALE_SOURCE_UNAVAILABLE');
      return offers.map((offer, index) => ({ ...offer, quantity: requests[index].quantity }));
    },
    browse: (store, input, locale = 'en') => list('offer', store, null, input, locale),
    getPublic: (store, offerId, locale = 'en') => item('offer', store, null, offerId, locale),
    async resolvePublic(store, key, locale = 'en') {
      checkStore(store);
      if (typeof key !== 'string' || key.length > 150) invalid();
      key = key.toLowerCase();
      if (legacyOfferIdPattern.test(key)) return item('offer', store, null, key, locale);
      if (!isOfferSlug(key)) invalid();
      const reserved = await repository.findOfferKey(store, key);
      if (!reserved) throw new AppError(404, 'WHOLESALE_OFFER_NOT_FOUND');
      return item('offer', store, null, String(reserved.offerId), locale);
    },
    listProducts: (store, identity, input) => list('product', store, identity, input),
    getProduct: (store, identity, productId) => item('product', store, identity, productId),
    listOffers: (store, identity, input) => list('offer', store, identity, input),
    getOffer: (store, identity, offerId) => item('offer', store, identity, offerId),
    createProduct: (store, identity, input) => mutate('product', store, identity, 'created', randomBytes(12).toString('hex'), input),
    updateProduct: (store, identity, productId, input) => mutate('product', store, identity, 'updated', productId, input),
    removeProduct: (store, identity, productId) => mutate('product', store, identity, 'deleted', productId, {}),
    createOffer: (store, identity, input) => mutate('offer', store, identity, 'created', randomBytes(12).toString('hex'), input),
    updateOffer: (store, identity, offerId, input) => mutate('offer', store, identity, 'updated', offerId, input),
    removeOffer: (store, identity, offerId) => mutate('offer', store, identity, 'deleted', offerId, {}),
    async selectB2c(store, identity, input) { checkStore(store); return products.listForWholesale(identity, input); },
    async getB2c(store, identity, productId) {
      checkStore(store); await staff(store, identity);
      const product = (await products.getForWholesale([id(productId)]))[0];
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND'); return product;
    },
    hasB2cReferences: (productId, variantIds, session) => repository.hasProductReferences('b2c', productId, variantIds, session),
  };
}
