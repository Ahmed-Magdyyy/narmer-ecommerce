import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { categoriesRepository } from './categories.repository.js';

const key = value => value == null ? null : String(value).toLowerCase();
function checkStore(store) {
  if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE');
}
function fieldsFrom(input) {
  const fields = {};
  for (const field of ['parentId', 'slug', 'position', 'isActive']) {
    if (Object.hasOwn(input, field)) fields[field] = input[field];
  }
  for (const field of ['name', 'description']) {
    for (const locale of ['ar', 'en']) {
      if (input[field] && Object.hasOwn(input[field], locale)) fields[`${field}.${locale}`] = input[field][locale];
    }
  }
  return fields;
}
function view(category, locale) {
  return { id: key(category._id), parentId: key(category.parentId), slug: category.slug,
    name: locale ? category.name[locale] : category.name,
    description: locale ? (category.description[locale] || category.description[locale === 'ar' ? 'en' : 'ar']) : category.description,
    position: category.position, isActive: category.isActive, image: category.image ?? null };
}
function indexTree(rows) {
  return new Map(rows.map(row => [key(row._id), row]));
}
function depth(id, nodes) {
  let current = id;
  const seen = new Set();
  while (current !== null) {
    if (seen.has(current)) throw new AppError(409, 'CATEGORY_CYCLE');
    seen.add(current);
    const node = nodes.get(current);
    if (!node) throw new AppError(409, 'CATEGORY_PARENT_NOT_FOUND');
    current = key(node.parentId);
  }
  return seen.size;
}
function visible(category, nodes) {
  let current = category;
  const seen = new Set();
  while (current) {
    const id = key(current._id);
    if (!current.isActive || seen.has(id)) return false;
    seen.add(id);
    if (current.parentId === null) return true;
    current = nodes.get(key(current.parentId));
  }
  return false;
}
function tree(rows, locale) {
  const items = new Map(rows.map(row => [key(row._id), { ...view(row, locale), children: [] }]));
  const roots = [];
  for (const row of rows) {
    const item = items.get(key(row._id));
    if (row.parentId == null) roots.push(item);
    else items.get(key(row.parentId))?.children.push(item);
  }
  return roots;
}

export function createCategoriesService({ auth, repository = categoriesRepository, transaction = runTransaction, products = null, media = null, sales = null, coupons = null }) {
  async function staffRows(store, identity) {
    checkStore(store);
    await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
    return repository.all(store);
  }
  async function mutate(store, identity, action, categoryId, input) {
    checkStore(store);
    categoryId = key(categoryId);
    let cleanup = false;
    try {
      const result = await transaction(async session => {
        const actor = await auth.authorizeStaff(store, identity,
          action === 'deleted' ? ['superAdmin'] : ['superAdmin', 'admin'], session);
        if (!await repository.lockTree(store, session)) throw new AppError(503, 'NOT_READY');
        const rows = await repository.all(store, session);
        const nodes = indexTree(rows);
        const existing = nodes.get(categoryId);
        if (action !== 'created' && !existing) throw new AppError(404, 'CATEGORY_NOT_FOUND');
        const fields = fieldsFrom(input);
        const previousIds = existing?.image ? [existing.image.id] : [];
        if (action === 'deleted' || Object.hasOwn(input, 'imageId')) {
          const requested = action === 'deleted' || input.imageId === null ? [] : [key(input.imageId)];
          if (requested.length || previousIds.length) {
            if (!media) throw new AppError(503, 'MEDIA_UNAVAILABLE');
            const images = await media.replace(store, 'category', categoryId, requested, previousIds, session);
            fields.image = requested.length ? images.get(requested[0]) : null;
          } else if (action !== 'deleted') fields.image = null;
          cleanup = previousIds.some(image => !requested.includes(image));
        }
        let changed;
        if (action === 'deleted') {
          if (rows.some(row => key(row.parentId) === categoryId)) throw new AppError(409, 'CATEGORY_HAS_CHILDREN');
          if (products && await products.hasAssignedCategory(store, categoryId, session)) throw new AppError(409, 'CATEGORY_HAS_PRODUCTS');
          if (sales && await sales.hasCategoryReferences(store, categoryId, session)) throw new AppError(409, 'CATEGORY_HAS_SALES');
          if (coupons && await coupons.hasCategoryReferences(store, categoryId, session)) throw new AppError(409, 'CATEGORY_HAS_COUPONS');
          await repository.remove(store, categoryId, session);
        } else {
          if (action === 'updated' && !Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR');
          const candidate = { ...(existing ?? {}), _id: categoryId,
            parentId: Object.hasOwn(fields, 'parentId') ? fields.parentId : (existing?.parentId ?? null) };
          nodes.set(categoryId, candidate);
          for (const id of nodes.keys()) {
            if (depth(id, nodes) > 3) throw new AppError(409, 'CATEGORY_DEPTH_EXCEEDED');
          }
          if (sales && existing && key(existing.parentId) !== key(candidate.parentId)) {
            await sales.validateCatalog(store, [...nodes.values()].map(row => ({ id: key(row._id), parentId: key(row.parentId) })), { session });
          }
          if (action === 'created') {
            changed = await repository.create({ _id: categoryId, store, parentId: candidate.parentId,
              name: { ar: fields['name.ar'], en: fields['name.en'] },
              description: { ar: fields['description.ar'] ?? '', en: fields['description.en'] ?? '' },
              slug: fields.slug, position: fields.position ?? 0, isActive: fields.isActive ?? true,
              image: fields.image ?? null }, session);
          } else changed = await repository.update(store, categoryId, fields, session);
        }
        await repository.audit({ store, actorId: actor._id, categoryId, action, fields: Object.keys(fields) }, session);
        return changed ? view(changed) : null;
      });
      if (cleanup) await media.cleanupTarget(store, 'category', categoryId);
      return result;
    } catch (error) {
      if (error.code === 11000) throw new AppError(409, 'CATEGORY_SLUG_EXISTS');
      throw error;
    }
  }
  return {
    async lockForCatalog(store, session) {
      checkStore(store);
      if (!session) throw new Error('Catalog mutations require a transaction session.');
      if (!await repository.lockTree(store, session)) throw new AppError(503, 'NOT_READY');
    },
    async getCatalogCategories(store, session = null) {
      checkStore(store);
      const rows = await repository.all(store, session);
      const nodes = indexTree(rows);
      return rows.map(row => ({ id: key(row._id), parentId: key(row.parentId), name: row.name, isVisible: visible(row, nodes) }));
    },
    async browse(store, locale) {
      checkStore(store);
      const rows = await repository.all(store);
      const nodes = indexTree(rows);
      return tree(rows.filter(row => visible(row, nodes)), locale);
    },
    async getPublic(store, id, locale) {
      checkStore(store);
      const rows = await repository.all(store);
      const nodes = indexTree(rows);
      const category = nodes.get(key(id));
      if (!category || !visible(category, nodes)) throw new AppError(404, 'CATEGORY_NOT_FOUND');
      return view(category, locale);
    },
    async list(store, identity, { page = 1, limit = 20, parentId, isActive } = {}) {
      const rows = (await staffRows(store, identity)).filter(row =>
        (parentId === undefined || key(row.parentId) === key(parentId)) && (isActive === undefined || row.isActive === isActive));
      return { items: rows.slice((page - 1) * limit, page * limit).map(row => view(row)),
        pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } };
    },
    async staffTree(store, identity) { return tree(await staffRows(store, identity)); },
    async getStaff(store, identity, id) {
      const row = (await staffRows(store, identity)).find(item => key(item._id) === key(id));
      if (!row) throw new AppError(404, 'CATEGORY_NOT_FOUND');
      return view(row);
    },
    create: (store, identity, input) => mutate(store, identity, 'created', randomBytes(12).toString('hex'), input),
    update: (store, identity, id, input) => mutate(store, identity, 'updated', id, input),
    remove: (store, identity, id) => mutate(store, identity, 'deleted', id, {}),
  };
}
