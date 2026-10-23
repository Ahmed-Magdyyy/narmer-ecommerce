import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { sizechartsRepository } from './sizecharts.repository.js';
import { normalizeMeasurements } from './sizecharts.measurements.js';

const languages = ['en', 'ar'];
const id = value => String(value).toLowerCase();
const invalid = () => { throw new AppError(422, 'VALIDATION_ERROR'); };
const scope = store => { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); };
const view = (row, assignedProductCount) => ({ id: id(row._id), version: row.version, name: row.name, isActive: row.isActive,
  images: { en: row.images.en, ar: row.images.ar }, alt: row.alt,
  measurements: row.measurements ?? null, assignedProductCount,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
function localized(input, previous = { en: '', ar: '' }, required = false, max = 500) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)
    || !Object.keys(input).length || Object.keys(input).some(key => !languages.includes(key)))) invalid();
  return Object.fromEntries(languages.map(language => {
    const value = input && Object.hasOwn(input, language) ? input[language] : previous[language];
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid();
    return [language, value.trim()];
  }));
}

export function createSizechartsService({ auth, categories, products, media, repository = sizechartsRepository, transaction = runTransaction }) {
  async function present(store, rows, session = null) {
    const counts = await products.countSizeChartAssignments(store, rows.map(row => id(row._id)), { session });
    return rows.map(row => view(row, counts.get(id(row._id)) ?? 0));
  }
  async function get(store, chartId, session = null) {
    scope(store);
    const row = await repository.findById(store, id(chartId), session);
    if (!row) throw new AppError(404, 'SIZE_CHART_NOT_FOUND');
    return row;
  }
  async function mutate(store, identity, chartId, input, action) {
    scope(store);
    const retired = [];
    const result = await transaction(async session => {
      const actor = await auth.authorizeStaff(store, identity, action === 'deleted' ? ['superAdmin'] : ['superAdmin', 'admin'], session);
      // Share the existing catalog write guard with Product assignment so deletion cannot leave dangling references.
      await categories.lockForCatalog(store, session);
      const previous = action === 'created' ? null : await get(store, chartId, session);
      if (action === 'deleted') {
        if (await products.hasSizeChartReferences(store, chartId, session)) throw new AppError(409, 'SIZE_CHART_IN_USE');
        for (const language of languages) if (previous.images[language]) {
          await media.replace(store, `size-chart-${language}`, chartId, [], [previous.images[language].id], session);
          retired.push(language);
        }
        await repository.remove(store, chartId, session);
      } else {
        if (previous && (input.version !== previous.version || previous.version === Number.MAX_SAFE_INTEGER)) throw new AppError(409, 'SIZE_CHART_CONFLICT');
        if (previous && !['name', 'alt', 'isActive', 'imageIds', 'measurements'].some(key => Object.hasOwn(input, key))) invalid();
        if (input.isActive !== undefined && typeof input.isActive !== 'boolean') invalid();
        if (input.imageIds !== undefined && (!input.imageIds || typeof input.imageIds !== 'object'
          || Array.isArray(input.imageIds) || !Object.keys(input.imageIds).length
          || Object.keys(input.imageIds).some(key => !languages.includes(key)))) invalid();
        const fields = { name: localized(input.name, previous?.name, true, 200), alt: localized(input.alt, previous?.alt),
          measurements: Object.hasOwn(input, 'measurements') ? normalizeMeasurements(input.measurements) : previous?.measurements ?? null,
          isActive: input.isActive ?? previous?.isActive ?? false, images: { en: null, ar: null } };
        for (const language of languages) {
          const oldImage = previous?.images[language] ?? null;
          const requested = input.imageIds && Object.hasOwn(input.imageIds, language) ? input.imageIds[language] : oldImage?.id ?? null;
          if (requested !== null && (typeof requested !== 'string' || !/^[a-f0-9]{24}$/i.test(requested))) invalid();
          const ids = requested === null ? [] : [id(requested)];
          if (ids.length || oldImage) {
            const images = await media.replace(store, `size-chart-${language}`, chartId, ids, oldImage ? [oldImage.id] : [], session);
            fields.images[language] = ids.length ? images.get(ids[0]) : null;
            if (oldImage && !ids.includes(oldImage.id)) retired.push(language);
          }
        }
        if (fields.isActive && !fields.measurements && !fields.images.en && !fields.images.ar) invalid();
        const changed = previous ? await repository.update(store, chartId, previous.version, fields, session)
          : await repository.create({ ...fields, _id: chartId, store, version: 0 }, session);
        if (!changed) throw new AppError(409, 'SIZE_CHART_CONFLICT');
        await repository.audit({ store, chartId, actorId: actor._id, action,
          fields: Object.keys(input).filter(key => key !== 'version') }, session);
        return (await present(store, [changed], session))[0];
      }
      await repository.audit({ store, chartId, actorId: actor._id, action, fields: [] }, session);
      return null;
    });
    for (const language of retired) await media.cleanupTarget(store, `size-chart-${language}`, chartId);
    return result;
  }
  return {
    async list(store, identity, input = {}) {
      scope(store); await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const page = input.page ?? 1, limit = input.limit ?? 20;
      const [rows, total] = await repository.list(store, { page, limit, isActive: input.isActive });
      return { items: await present(store, rows), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },
    async getStaff(store, identity, chartId) {
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      return (await present(store, [await get(store, chartId)]))[0];
    },
    create: (store, identity, input) => mutate(store, identity, randomBytes(12).toString('hex'), input, 'created'),
    update: (store, identity, chartId, input) => mutate(store, identity, id(chartId), input, 'updated'),
    remove: (store, identity, chartId) => mutate(store, identity, id(chartId), {}, 'deleted'),
    async upload(store, identity, chartId, language, buffer, contentType) {
      if (!languages.includes(language)) invalid();
      return media.upload(store, identity, `size-chart-${language}`, chartId, buffer, contentType);
    },
    async validateAssignment(store, chartId, session) { await get(store, chartId, session); },
    async publicForProducts(store, ids, locale = 'en') {
      scope(store);
      const rows = ids.length ? await repository.publicByIds(store, ids) : [];
      const text = value => value[locale] || value[locale === 'ar' ? 'en' : 'ar'];
      return new Map(rows.flatMap(row => {
        const image = row.images[locale] ?? row.images[locale === 'ar' ? 'en' : 'ar'];
        const measurements = row.measurements ?? null;
        return image || measurements ? [[id(row._id), { id: id(row._id), name: text(row.name), image: image ?? null,
          alt: text(row.alt) || text(row.name), measurements }]] : [];
      }));
    },
  };
}
