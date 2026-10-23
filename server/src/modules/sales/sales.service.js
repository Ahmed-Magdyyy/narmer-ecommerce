import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { salesRepository } from './sales.repository.js';

const invalid = () => { throw new AppError(422, 'INVALID_SALE'); };
const checkStore = store => { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); };
const id = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid();
  return value.toLowerCase();
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) invalid();
  return result;
};
function build(input, previous) {
  const targetType = input.targetType ?? previous?.targetType;
  const changedTarget = previous && targetType !== previous.targetType;
  const productIds = Object.hasOwn(input, 'productIds') ? input.productIds : (changedTarget ? [] : previous?.productIds ?? []);
  const categoryId = Object.hasOwn(input, 'categoryId') ? input.categoryId : (changedTarget ? null : previous?.categoryId ?? null);
  const name = Object.fromEntries(['ar', 'en'].map(locale => {
    const value = Object.hasOwn(input.name ?? {}, locale) ? input.name[locale] : previous?.name[locale];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 150) invalid();
    return [locale, value.trim()];
  }));
  const fields = { name, targetType, productIds: [], categoryId: null,
    discountType: input.discountType ?? previous?.discountType,
    discountValue: Object.hasOwn(input, 'discountValue') ? input.discountValue : previous?.discountValue,
    startsAt: Object.hasOwn(input, 'startsAt') ? date(input.startsAt) : previous?.startsAt,
    endsAt: Object.hasOwn(input, 'endsAt') ? date(input.endsAt) : previous?.endsAt,
    isEnabled: Object.hasOwn(input, 'isEnabled') ? input.isEnabled : previous?.isEnabled ?? true };
  if (!['products', 'category'].includes(targetType) || !Array.isArray(productIds) || productIds.length > 100
    || typeof fields.isEnabled !== 'boolean' || !['percentage', 'fixed'].includes(fields.discountType)
    || !Number.isSafeInteger(fields.discountValue) || fields.discountValue < 1
    || fields.discountValue > (fields.discountType === 'percentage' ? 100 : 1000000000)
    || !fields.startsAt || !fields.endsAt || fields.endsAt <= fields.startsAt) invalid();
  if (targetType === 'products') {
    if (!productIds.length || categoryId !== null) invalid();
    fields.productIds = productIds.map(value => id(String(value)));
    if (new Set(fields.productIds).size !== fields.productIds.length) invalid();
  } else {
    if (productIds.length || categoryId === null) invalid();
    fields.categoryId = id(String(categoryId));
  }
  return fields;
}
const status = (row, at) => !row.isEnabled ? 'disabled' : at < row.startsAt ? 'scheduled' : at >= row.endsAt ? 'expired' : 'active';
const view = (row, at) => ({ id: String(row._id), name: row.name, targetType: row.targetType,
  productIds: row.productIds.map(String), categoryId: row.categoryId == null ? null : String(row.categoryId),
  discountType: row.discountType, discountValue: row.discountValue,
  startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), isEnabled: row.isEnabled,
  status: status(row, at), currency: 'EGP' });

export function createSalesService({ auth, categories, products, repository = salesRepository, transaction = runTransaction, now = () => new Date() }) {
  function scopes(catalog) {
    const parents = new Map(catalog.map(category => [category.id, category.parentId]));
    return (categoryId, rootId) => {
      for (let current = categoryId; current != null; current = parents.get(current) ?? null) {
        if (current === rootId) return true;
      }
      return false;
    };
  }
  async function validateCatalog(store, catalog, { session, candidate = null, replaceId = null, productChange = null } = {}) {
    checkStore(store);
    const campaigns = (await repository.enabled(store, session)).filter(row => String(row._id) !== replaceId);
    if (candidate?.isEnabled) campaigns.push(candidate);
    if (campaigns.length < 2) return;
    const productIds = [...new Set(campaigns.flatMap(row => row.productIds.map(String)))];
    const selected = new Map((await products.getCatalogReferences(store, productIds, { session })).map(row => [row.id, row.categoryId]));
    if (productChange) selected.set(productChange.id, productChange.categoryId);
    const contains = scopes(catalog);
    function intersects(a, b) {
      if (a.targetType === 'category' && b.targetType === 'category') {
        return contains(String(a.categoryId), String(b.categoryId)) || contains(String(b.categoryId), String(a.categoryId));
      }
      if (a.targetType === 'products' && b.targetType === 'products') {
        const ids = new Set(a.productIds.map(String));
        return b.productIds.some(value => ids.has(String(value)));
      }
      const category = a.targetType === 'category' ? a : b;
      const items = a.targetType === 'products' ? a : b;
      return items.productIds.some(value => contains(selected.get(String(value)), String(category.categoryId)));
    }
    for (let i = 0; i < campaigns.length; i++) {
      for (let j = i + 1; j < campaigns.length; j++) {
        const a = campaigns[i], b = campaigns[j];
        if (a.startsAt < b.endsAt && b.startsAt < a.endsAt && intersects(a, b)) throw new AppError(409, 'SALE_OVERLAP');
      }
    }
  }
  async function applyPrices(store, items, catalog, { session = null, locale = 'en', at = now() } = {}) {
    checkStore(store);
    if (!items.length) return items;
    const campaigns = await repository.active(store, at, session);
    const contains = scopes(catalog);
    return items.map(product => {
      const campaign = campaigns.find(row => row.targetType === 'products'
        ? row.productIds.some(value => String(value) === product.id)
        : contains(product.categoryId, String(row.categoryId)));
      const activeSale = campaign ? { id: String(campaign._id), name: locale ? campaign.name[locale] : campaign.name,
        discountType: campaign.discountType, discountValue: campaign.discountValue,
        startsAt: campaign.startsAt.toISOString(), endsAt: campaign.endsAt.toISOString() } : null;
      const price = item => {
        if (!campaign) return { ...item, activeSale: null };
        const discountedPrice = Math.max(0, item.price - (campaign.discountType === 'fixed'
          ? campaign.discountValue : Math.floor(item.price * campaign.discountValue / 100)));
        return { ...item, discountedPrice, effectivePrice: discountedPrice, activeSale };
      };
      if (product.type === 'simple') return price(product);
      const variants = product.variants.map(price);
      return { ...product, variants, priceFrom: Math.min(...variants.map(item => item.effectivePrice)) };
    });
  }
  async function mutate(store, identity, action, saleId, input) {
    checkStore(store);
    return transaction(async session => {
      const actor = await auth.authorizeStaff(store, identity, action === 'deleted' ? ['superAdmin'] : ['superAdmin', 'admin'], session);
      await categories.lockForCatalog(store, session);
      const previous = action === 'created' ? null : await repository.findById(store, saleId, session);
      if (action !== 'created' && !previous) throw new AppError(404, 'SALE_NOT_FOUND');
      let changed;
      if (action === 'deleted') await repository.remove(store, saleId, session);
      else {
        const selected = Object.keys(input).filter(key => ['name', 'targetType', 'productIds', 'categoryId', 'discountType', 'discountValue', 'startsAt', 'endsAt', 'isEnabled'].includes(key));
        if (action === 'updated' && !selected.length) invalid();
        const fields = build(input, previous);
        const catalog = await categories.getCatalogCategories(store, session);
        if (fields.targetType === 'products') {
          const rows = await products.getCatalogReferences(store, fields.productIds, { session });
          if (rows.length !== fields.productIds.length) throw new AppError(409, 'SALE_TARGET_NOT_FOUND');
        } else {
          if (!catalog.some(category => category.id === fields.categoryId)) throw new AppError(409, 'SALE_TARGET_NOT_FOUND');
        }
        await validateCatalog(store, catalog, { session, candidate: fields, replaceId: previous ? String(previous._id) : null });
        changed = previous ? await repository.update(store, saleId, fields, session)
          : await repository.create({ store, ...fields }, session);
        if (!changed) throw new AppError(409, 'SALE_CONFLICT');
      }
      await repository.audit({ store, actorId: actor._id, saleId: changed?._id ?? previous._id,
        action, fields: Object.keys(input).filter(key => ['name', 'targetType', 'productIds', 'categoryId', 'discountType', 'discountValue', 'startsAt', 'endsAt', 'isEnabled'].includes(key)) }, session);
      return changed ? view(changed, now()) : null;
    });
  }
  return {
    validateCatalog,
    applyPrices,
    hasProductReferences: (store, productId, session) => repository.hasProductReferences(store, productId, session),
    hasCategoryReferences: (store, categoryId, session) => repository.hasCategoryReferences(store, categoryId, session),
    async list(store, identity, input = {}) {
      checkStore(store);
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const page = input.page ?? 1, limit = input.limit ?? 20;
      const [rows, total] = await repository.list(store, { ...input, page, limit });
      const at = now();
      return { items: rows.map(row => view(row, at)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },
    async getStaff(store, identity, saleId) {
      checkStore(store);
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const row = await repository.findById(store, saleId);
      if (!row) throw new AppError(404, 'SALE_NOT_FOUND');
      return view(row, now());
    },
    create: (store, identity, input) => mutate(store, identity, 'created', null, input),
    update: (store, identity, saleId, input) => mutate(store, identity, 'updated', saleId, input),
    remove: (store, identity, saleId) => mutate(store, identity, 'deleted', saleId, {}),
  };
}
