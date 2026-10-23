import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { productsRepository } from './products.repository.js';

const id = value => String(value).toLowerCase();
const newId = () => randomBytes(12).toString('hex');
const invalid = () => { throw new AppError(422, 'INVALID_PRODUCT'); };
const isMoney = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const safeKey = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
const safeValue = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
const text = (value, required, max) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid();
  return value.trim();
};
function imageIds(value, previous = []) {
  const ids = value === undefined ? previous.map(image => image.id) : value;
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(image => typeof image !== 'string' || !/^[a-f0-9]{24}$/i.test(image))) invalid();
  const normalized = ids.map(image => image.toLowerCase());
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized;
}
const allImageIds = product => product ? [...new Set([...(product.images ?? []),
  ...(product.variants ?? []).flatMap(variant => variant.images ?? [])].map(image => image.id))] : [];
function checkStore(store) { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); }
function prices(source, previous = {}) {
  previous ??= {};
  const skuInput = Object.hasOwn(source, 'sku') ? source.sku : previous.sku;
  if (skuInput != null && typeof skuInput !== 'string') invalid();
  const sku = skuInput?.trim().toUpperCase() || null;
  if (sku && !/^[A-Z0-9][A-Z0-9._/-]{0,99}$/.test(sku)) invalid();
  const price = source.price ?? previous.price;
  const stock = source.stock ?? previous.stock ?? 0;
  const discountedPrice = Object.hasOwn(source, 'discountedPrice') ? source.discountedPrice : (previous.discountedPrice ?? null);
  if (!isMoney(price) || !isMoney(stock) || (discountedPrice !== null && (!isMoney(discountedPrice) || discountedPrice >= price))) invalid();
  return { sku, price, discountedPrice, stock };
}
function bilingual(source, previous = {}, required = true, max = 200) {
  return Object.fromEntries(['ar', 'en'].map(locale => [locale,
    text(source?.[locale] ?? previous[locale] ?? '', required, max)]));
}
function build(input, previous) {
  const type = previous?.type ?? input.type;
  if (previous && input.type && input.type !== previous.type) throw new AppError(409, 'PRODUCT_TYPE_IMMUTABLE');
  const product = {
    type, categoryId: id(input.categoryId ?? previous?.categoryId),
    name: bilingual(input.name, previous?.name), description: bilingual(input.description, previous?.description, false, 10000),
    slug: input.slug ?? previous?.slug, isActive: input.isActive ?? previous?.isActive ?? true,
    sizeChartId: Object.hasOwn(input, 'sizeChartId') ? (input.sizeChartId === null ? null : id(input.sizeChartId)) : previous?.sizeChartId ?? null,
  };
  if (!['simple', 'variant'].includes(type) || !/^[a-f0-9]{24}$/.test(product.categoryId)
    || typeof product.slug !== 'string' || product.slug.length > 150 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)
    || typeof product.isActive !== 'boolean' || product.sizeChartId !== null && !/^[a-f0-9]{24}$/.test(product.sizeChartId)) invalid();
  if (type === 'simple') {
    if (input.options?.length || input.variants?.length) invalid();
    Object.assign(product, prices(input, previous), { options: [], variants: [] });
    product.skuKeys = product.sku ? [product.sku] : [];
  } else {
    if (['sku', 'price', 'discountedPrice', 'stock'].some(field => Object.hasOwn(input, field))) invalid();
    const options = input.options ?? previous?.options;
    if (!Array.isArray(options) || !options.length || options.length > 5) invalid();
    const optionKeys = new Set();
    product.options = options.map(option => {
      if (!safeKey(option.key) || optionKeys.has(option.key) || !Array.isArray(option.values)
        || !option.values.length || option.values.length > 50) invalid();
      optionKeys.add(option.key);
      const values = new Set();
      return { key: option.key, name: bilingual(option.name), values: option.values.map(value => {
        if (!safeValue(value.key) || values.has(value.key)) invalid();
        values.add(value.key);
        return { key: value.key, name: bilingual(value.name) };
      }) };
    });
    const variants = input.variants ?? previous?.variants;
    if (!Array.isArray(variants) || !variants.length || variants.length > 100) invalid();
    const previousVariants = new Map((previous?.variants ?? []).map(variant => [id(variant._id), variant]));
    const variantIds = new Set();
    const combinations = new Set();
    product.variants = variants.map(variant => {
      const variantId = variant.id ? id(variant.id) : (!Object.hasOwn(input, 'variants') ? id(variant._id) : newId());
      if (variant.id && !previousVariants.has(variantId)) invalid();
      if (variantIds.has(variantId)) invalid();
      variantIds.add(variantId);
      const selection = variant.values instanceof Map ? Object.fromEntries(variant.values) : variant.values;
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)
        || Object.keys(selection).length !== optionKeys.size) invalid();
      const values = {};
      for (const option of product.options) {
        if (!Object.hasOwn(selection, option.key) || !option.values.some(value => value.key === selection[option.key])) invalid();
        values[option.key] = selection[option.key];
      }
      const signature = JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
      if (combinations.has(signature)) invalid();
      combinations.add(signature);
      return { _id: variantId, ...prices(variant, previousVariants.get(variantId)), values,
        images: previousVariants.get(variantId)?.images ?? [] };
    });
    Object.assign(product, { sku: null, price: null, discountedPrice: null, stock: null });
    product.skuKeys = product.variants.map(variant => variant.sku).filter(Boolean);
    if (new Set(product.skuKeys).size !== product.skuKeys.length) throw new AppError(409, 'PRODUCT_SKU_EXISTS');
  }
  product.images = previous?.images ?? [];
  return product;
}
const localText = (value, locale) => locale ? (value[locale] || value[locale === 'ar' ? 'en' : 'ar']) : value;
function wholesaleView(product, locale) {
  return { id: id(product._id), type: product.type, name: localText(product.name, locale),
    description: localText(product.description, locale), images: product.images ?? [],
    options: product.options.map(option => ({ key: option.key, name: localText(option.name, locale),
      values: option.values.map(value => ({ key: value.key, name: localText(value.name, locale) })) })),
    variants: product.variants.map(variant => ({ id: id(variant._id), values: variant.values,
      images: variant.images?.length ? variant.images : (product.images ?? []) })) };
}
function view(product, locale) {
  const basic = { id: id(product._id), type: product.type, categoryId: id(product.categoryId),
    name: localText(product.name, locale), description: localText(product.description, locale),
    slug: product.slug, isActive: product.isActive, images: product.images ?? [], currency: 'EGP',
    ...(locale ? {} : { version: product.version, sizeChartId: product.sizeChartId ? id(product.sizeChartId) : null }) };
  const priceView = item => ({ sku: item.sku, price: item.price, discountedPrice: item.discountedPrice,
    effectivePrice: item.discountedPrice ?? item.price, stock: item.stock });
  if (product.type === 'simple') return { ...basic, ...priceView(product) };
  return { ...basic, options: product.options.map(option => ({ key: option.key, name: localText(option.name, locale),
    values: option.values.map(value => ({ key: value.key, name: localText(value.name, locale) })) })),
  variants: product.variants.map(variant => ({ id: id(variant._id), ...priceView(variant), values: variant.values,
    images: locale && !variant.images?.length ? (product.images ?? []) : (variant.images ?? []) })),
  priceFrom: Math.min(...product.variants.map(variant => variant.discountedPrice ?? variant.price)) };
}

// Filters always describe one real sellable item, never values from different variants.
function matchingItems(product, input) {
  return (product.type === 'simple' ? [product] : product.variants).filter(item =>
    (input.size === undefined || item.values?.size === input.size)
    && (input.color === undefined || item.values?.color === input.color)
    && (input.minPrice === undefined || item.effectivePrice >= input.minPrice)
    && (input.maxPrice === undefined || item.effectivePrice <= input.maxPrice)
    && (!input.saleOnly || item.effectivePrice < item.price));
}
const priceFields = item => ({ price: item.price, discountedPrice: item.discountedPrice ?? null,
  effectivePrice: item.effectivePrice, activeSale: item.activeSale ?? null });

export function createProductsService({ auth, categories, repository = productsRepository, transaction = runTransaction, references = null, media = null, sales = null, sizeCharts = null, now = () => new Date() }) {
  async function addSizeCharts(items, rows, locale) {
    const byId = new Map(rows.map(row => [id(row._id), row.sizeChartId ? id(row.sizeChartId) : null]));
    const ids = [...new Set([...byId.values()].filter(Boolean))];
    const charts = sizeCharts && ids.length ? await sizeCharts.publicForProducts('b2c', ids, locale) : new Map();
    return items.map(item => ({ ...item, sizeChart: charts.get(byId.get(item.id)) ?? null }));
  }
  async function publicCandidates(store, input, locale) {
    checkStore(store);
    const at = now();
    const catalog = await categories.getCatalogCategories(store);
    let eligible = catalog.filter(category => category.isVisible);
    if (input.categoryId) {
      const root = id(input.categoryId);
      if (!eligible.some(category => category.id === root)) throw new AppError(404, 'CATEGORY_NOT_FOUND');
      const scope = new Set([root]);
      for (let level = 0; level < 2; level++) {
        for (const category of eligible) if (scope.has(category.parentId)) scope.add(category.id);
      }
      eligible = eligible.filter(category => scope.has(category.id));
    }
    // shortcut: scan only public pricing/option projections; use an indexed pricing read model if catalog size makes this slow.
    const rows = await repository.browseCandidates(store, { categoryIds: eligible.map(category => category.id), type: input.type });
    const sellable = item => ({ ...item, id: id(item._id), effectivePrice: item.discountedPrice ?? item.price, activeSale: null });
    const candidates = rows.map(row => ({ ...sellable(row), categoryId: id(row.categoryId),
      variants: (row.variants ?? []).map(sellable) }));
    return { at, items: sales ? await sales.applyPrices(store, candidates, catalog, { locale, at }) : candidates };
  }
  async function browse(store, input, locale) {
    const { items } = await publicCandidates(store, input, locale);
    const matches = items.flatMap(product => {
      const choices = matchingItems(product, input).sort((a, b) => a.effectivePrice - b.effectivePrice || a.id.localeCompare(b.id));
      return choices.length ? [{ product, chosen: choices[0] }] : [];
    });
    if (input.sort === 'price-asc' || input.sort === 'price-desc') {
      const direction = input.sort === 'price-asc' ? 1 : -1;
      matches.sort((a, b) => direction * (a.chosen.effectivePrice - b.chosen.effectivePrice)
        || a.product.id.localeCompare(b.product.id));
    }
    const page = input.page ?? 1, limit = input.limit ?? 20, total = matches.length;
    const selected = matches.slice((page - 1) * limit, page * limit);
    const rows = selected.length ? await repository.findByIds(store, selected.map(item => item.product.id)) : [];
    const byId = new Map(rows.map(row => [id(row._id), row]));
    const result = selected.flatMap(({ product, chosen }) => {
      const row = byId.get(product.id);
      if (!row || !row.isActive || row.version !== product.version || id(row.categoryId) !== product.categoryId) return [];
      const dto = view(row, locale);
      if (product.type !== dto.type) return [];
      if (dto.type === 'simple') Object.assign(dto, priceFields(product));
      else {
        const priced = new Map(product.variants.map(item => [item.id, item]));
        if (!dto.variants.some(item => item.id === chosen.id)) return [];
        dto.variants = dto.variants.filter(item => priced.has(item.id)).map(item => ({ ...item, ...priceFields(priced.get(item.id)) }));
        dto.priceFrom = Math.min(...dto.variants.map(item => item.effectivePrice));
      }
      return [{ ...dto, matchingVariantId: dto.type === 'variant' ? chosen.id : null, matchingPrice: chosen.effectivePrice }];
    });
    return { items: await addSizeCharts(result, rows, locale), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  async function facets(store, input, locale) {
    const { at, items } = await publicCandidates(store, input, locale);
    const values = key => {
      const choices = new Map();
      for (const product of items) {
        const options = product.options?.find(option => option.key === key)?.values ?? [];
        const matching = matchingItems(product, { ...input, [key]: undefined });
        const present = new Set(matching.map(item => item.values?.[key]));
        for (const option of options) {
          if (!choices.has(option.key)) choices.set(option.key, { key: option.key, name: localText(option.name, locale), count: 0 });
          if (present.has(option.key)) choices.get(option.key).count++;
        }
      }
      return [...choices.values()].sort((a, b) => a.key.localeCompare(b.key));
    };
    let min = null, max = null;
    for (const product of items) {
      for (const item of matchingItems(product, { ...input, minPrice: undefined, maxPrice: undefined })) {
        min = min === null ? item.effectivePrice : Math.min(min, item.effectivePrice);
        max = max === null ? item.effectivePrice : Math.max(max, item.effectivePrice);
      }
    }
    return { currency: 'EGP', pricedAt: at.toISOString(), price: { min, max }, sizes: values('size'), colors: values('color'),
      applied: { categoryId: input.categoryId ? id(input.categoryId) : null, type: input.type ?? null,
        minPrice: input.minPrice ?? null, maxPrice: input.maxPrice ?? null, size: input.size ?? null,
        color: input.color ?? null, saleOnly: input.saleOnly ?? false } };
  }
  async function mutation(store, identity, action, productId, input) {
    checkStore(store);
    productId = id(productId);
    let cleanup = false;
    try {
      const result = await transaction(async session => {
        const actor = await auth.authorizeStaff(store, identity, action === 'deleted' ? ['superAdmin'] : ['superAdmin', 'admin'], session);
        await categories.lockForCatalog(store, session);
        const previous = action === 'created' ? null : await repository.findById(store, productId, session);
        if (action !== 'created' && !previous) throw new AppError(404, 'PRODUCT_NOT_FOUND');
        let changed;
        if (action === 'deleted') {
          if (references && await references.hasProductReferences(store, productId, null, session)) throw new AppError(409, 'PRODUCT_REFERENCED');
          const oldImages = allImageIds(previous);
          if (oldImages.length) {
            if (!media) throw new AppError(503, 'MEDIA_UNAVAILABLE');
            await media.replace(store, 'product', productId, [], oldImages, session);
          }
          cleanup = oldImages.length > 0;
          await repository.remove(store, productId, session);
        } else {
          if (previous && input.version !== previous.version) throw new AppError(409, 'PRODUCT_CONFLICT');
          if (previous && !Object.keys(input).some(field => ['name', 'description', 'categoryId', 'sizeChartId', 'slug', 'isActive', 'sku', 'price', 'discountedPrice', 'stock', 'options', 'variants', 'type', 'imageIds'].includes(field))) invalid();
          const fields = build(input, previous);
          if (fields.sizeChartId !== null) {
            if (!sizeCharts) throw new AppError(404, 'SIZE_CHART_NOT_FOUND');
            await sizeCharts.validateAssignment(store, fields.sizeChartId, session);
          }
          const catalog = await categories.getCatalogCategories(store, session);
          if (!catalog.some(category => category.id === fields.categoryId)) throw new AppError(409, 'CATEGORY_PARENT_NOT_FOUND');
          if (sales && previous && id(previous.categoryId) !== fields.categoryId) {
            await sales.validateCatalog(store, catalog, { session, productChange: { id: productId, categoryId: fields.categoryId } });
          }
          if (previous?.type === 'variant' && references) {
            const retained = new Set(fields.variants.map(variant => id(variant._id)));
            const removed = previous.variants.filter(variant => !retained.has(id(variant._id))).map(variant => id(variant._id));
            if (removed.length && await references.hasProductReferences(store, productId, removed, session)) throw new AppError(409, 'PRODUCT_REFERENCED');
          }
          const productImages = imageIds(input.imageIds, fields.images);
          const variantImages = fields.variants.map((variant, index) => imageIds(input.variants?.[index]?.imageIds, variant.images));
          const requested = [...new Set([...productImages, ...variantImages.flat()])];
          const oldImages = allImageIds(previous);
          if (requested.length || oldImages.length) {
            if (!media) throw new AppError(503, 'MEDIA_UNAVAILABLE');
            const resolved = await media.replace(store, 'product', productId, requested, oldImages, session);
            fields.images = productImages.map(image => resolved.get(image));
            fields.variants.forEach((variant, index) => { variant.images = variantImages[index].map(image => resolved.get(image)); });
          }
          cleanup = oldImages.some(image => !requested.includes(image));
          changed = previous ? await repository.update(store, productId, previous.version, fields, session)
            : await repository.create({ ...fields, _id: productId, store, version: 0 }, session);
          if (!changed) throw new AppError(409, 'PRODUCT_CONFLICT');
        }
        await repository.audit({ store, actorId: actor._id, productId, action,
          fields: Object.keys(input).filter(field => ['name', 'description', 'categoryId', 'sizeChartId', 'slug', 'isActive', 'sku', 'price', 'discountedPrice', 'stock', 'options', 'variants', 'type', 'imageIds'].includes(field)) }, session);
        return changed ? view(changed) : null;
      });
      if (cleanup) await media.cleanupTarget(store, 'product', productId);
      return result;
    } catch (error) {
      if (error.code === 11000) throw new AppError(409, error.keyPattern?.slug ? 'PRODUCT_SLUG_EXISTS' : 'PRODUCT_SKU_EXISTS');
      throw error;
    }
  }
  async function list(store, input, identity, locale) {
    checkStore(store);
    if (identity) await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
    const catalog = await categories.getCatalogCategories(store);
    let eligible = identity ? catalog : catalog.filter(category => category.isVisible);
    if (input.categoryId) {
      const rootId = id(input.categoryId);
      if (!eligible.some(category => category.id === rootId)) throw new AppError(404, 'CATEGORY_NOT_FOUND');
      const scope = new Set([rootId]);
      for (let level = 0; level < 2; level++) {
        for (const category of eligible) if (scope.has(category.parentId)) scope.add(category.id);
      }
      eligible = eligible.filter(category => scope.has(category.id));
    }
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const [items, total] = await repository.list(store, { page, limit, type: input.type,
      categoryIds: eligible.map(category => category.id), isActive: identity ? input.isActive : true });
    const result = items.map(item => view(item, locale));
    return { items: !identity && sales ? await sales.applyPrices(store, result, catalog, { locale }) : result,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  async function get(store, productId, identity, locale) {
    checkStore(store);
    if (identity) await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
    const product = await repository.findById(store, id(productId));
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND');
    if (!identity) {
      const catalog = await categories.getCatalogCategories(store);
      if (!product.isActive || !catalog.some(category => category.id === id(product.categoryId) && category.isVisible)) throw new AppError(404, 'PRODUCT_NOT_FOUND');
      const result = sales ? await sales.applyPrices(store, [view(product, locale)], catalog, { locale }) : [view(product, locale)];
      return (await addSizeCharts(result, [product], locale))[0];
    }
    return view(product, locale);
  }
  return {
    async getForHomepage(productIds, locale = 'en') {
      if (!Array.isArray(productIds) || productIds.length > 40) invalid();
      if (!productIds.length) return [];
      const catalog = await categories.getCatalogCategories('b2c');
      const visible = new Set(catalog.filter(category => category.isVisible).map(category => category.id));
      const rows = (await repository.findByIds('b2c', productIds.map(id))).filter(row => row.isActive && visible.has(id(row.categoryId)));
      const items = rows.map(row => view(row, locale));
      const priced = sales ? await sales.applyPrices('b2c', items, catalog, { locale }) : items;
      return addSizeCharts(priced, rows, locale);
    },
    async getWholesaleProductIds() {
      const catalog = await categories.getCatalogCategories('b2c');
      return repository.publicIds('b2c', catalog.filter(category => category.isVisible).map(category => category.id));
    },
    async getForWholesale(productIds, { session = null, locale } = {}) {
      if (!Array.isArray(productIds) || productIds.length > 100) invalid();
      if (!productIds.length) return [];
      const catalog = await categories.getCatalogCategories('b2c', session);
      const visible = new Set(catalog.filter(category => category.isVisible).map(category => category.id));
      return (await repository.findByIds('b2c', productIds.map(id), session))
        .filter(row => row.isActive && visible.has(id(row.categoryId))).map(row => wholesaleView(row, locale));
    },
    async listForWholesale(identity, input, locale) {
      await auth.authorizeStaff('b2b', identity, ['superAdmin', 'admin']);
      const catalog = await categories.getCatalogCategories('b2c');
      const visible = catalog.filter(category => category.isVisible).map(category => category.id);
      const page = input.page ?? 1, limit = input.limit ?? 20;
      const [items, total] = await repository.list('b2c', { page, limit, categoryIds: visible, isActive: true, type: input.type, q: input.q });
      return { items: items.map(row => wholesaleView(row, locale)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },
    async adjustOrderStock(store, items, { session, restore = false }) {
      checkStore(store);
      if (!session) throw new Error('Order stock changes require a transaction session.');
      await categories.lockForCatalog(store, session);
      for (const item of items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000
          || !/^[a-f0-9]{24}$/.test(item.productId) || (item.variantId !== null && !/^[a-f0-9]{24}$/.test(item.variantId))) invalid();
        const result = await repository.adjustStock(store, item.productId, item.variantId, item.quantity, restore, session);
        if (result.matchedCount !== 1) throw new AppError(409, restore ? 'ORDER_STOCK_RESTORE_FAILED' : 'ORDER_STOCK_UNAVAILABLE');
      }
    },
    async getCatalogReferences(store, productIds, { session = null } = {}) {
      checkStore(store);
      if (!productIds.length) return [];
      return (await repository.findByIds(store, productIds, session)).map(row => ({ id: id(row._id), categoryId: id(row.categoryId) }));
    },
    async getOrderCategories(store, productIds, { session = null } = {}) {
      checkStore(store);
      const catalog = new Map((await categories.getCatalogCategories(store, session)).map(row => [row.id, row]));
      return (await repository.findByIds(store, productIds, session)).map(row => {
        const category = catalog.get(id(row.categoryId));
        return { productId: id(row._id), category: category ? { id: category.id, name: category.name } : null };
      });
    },
    async getReportMetadata(productIds) {
      if (!productIds.length) return [];
      if (productIds.length > 100) invalid();
      return (await repository.findByIds('b2c', productIds)).map(row => ({ id: id(row._id), slug: row.slug, image: row.images?.[0] ?? null }));
    },
    lockForCart(store, session) { checkStore(store); return categories.lockForCatalog(store, session); },
    async getForCart(store, productIds, { session = null, locale = 'en', at } = {}) {
      checkStore(store);
      if (!Array.isArray(productIds) || productIds.length > 100) invalid();
      if (!productIds.length) return [];
      const catalog = await categories.getCatalogCategories(store, session);
      const visible = new Set(catalog.filter(category => category.isVisible).map(category => category.id));
      const rows = await repository.findByIds(store, productIds.map(id), session);
      const items = rows.filter(row => row.isActive && visible.has(id(row.categoryId))).map(row => view(row, locale));
      return sales ? sales.applyPrices(store, items, catalog, { session, locale, at }) : items;
    },
    browse,
    facets,
    list: (store, identity, input) => list(store, input, identity),
    getPublic: (store, productId, locale) => get(store, productId, null, locale),
    getStaff: (store, identity, productId) => get(store, productId, identity),
    hasAssignedCategory(store, categoryId, session) { checkStore(store); return repository.hasAssignedCategory(store, categoryId, session); },
    hasSizeChartReferences(store, chartId, session) { checkStore(store); return repository.hasSizeChartReferences(store, chartId, session); },
    async countSizeChartAssignments(store, chartIds, { session = null } = {}) {
      checkStore(store);
      if (!chartIds.length) return new Map();
      const rows = await repository.countSizeChartAssignments(store, chartIds, session);
      return new Map(rows.map(row => [id(row._id), row.count]));
    },
    create: (store, identity, input) => mutation(store, identity, 'created', newId(), input),
    update: (store, identity, productId, input) => mutation(store, identity, 'updated', productId, input),
    remove: (store, identity, productId) => mutation(store, identity, 'deleted', productId, {}),
  };
}
