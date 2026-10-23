import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { sizechartsFixture, chartInput, measurementInput } from './helpers/sizecharts.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { SizeChart } from '../src/modules/sizecharts/sizecharts.model.js';
import { normalizeMeasurements } from '../src/modules/sizecharts/sizecharts.measurements.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { sizechartsRepository } from '../src/modules/sizecharts/sizecharts.repository.js';
import { createBunnyStorage } from '../src/shared/infrastructure/media/bunny.js';

const actor = { userId: 'a'.repeat(24), role: 'superAdmin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (!roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: identity.userId };
} };
const image = () => sharp({ create: { width: 20, height: 30, channels: 3, background: 'white' } }).png().toBuffer();

test('editable measurement charts preserve ordered numeric data, derive assignment counts and remain independent of variants and Product versions', async () => {
  const f = sizechartsFixture(auth), measurements = normalizeMeasurements(measurementInput);
  const category = await f.p.categories.create('b2c', actor, { slug: 'numeric', name: { en: 'Clothing', ar: 'ملابس' } });
  const first = await f.charts.create('b2c', actor, { ...chartInput, measurements: measurementInput, isActive: true });
  const second = await f.charts.create('b2c', actor, { ...chartInput, measurements, isActive: true });
  assert.deepEqual(first.measurements, measurements); assert.equal(first.assignedProductCount, 0);
  await new SizeChart(f.rows.get(first.id)).validate();
  const a = await f.products.create('b2c', actor, { ...simpleInput(category.id, 'a'), sizeChartId: first.id });
  const b = await f.products.create('b2c', actor, { ...variantInput(category.id, 'b'), sizeChartId: first.id, isActive: false });
  const c = await f.products.create('b2c', actor, { ...simpleInput(category.id, 'c'), sizeChartId: second.id });
  const d = await f.products.create('b2c', actor, simpleInput(category.id, 'd'));
  assert.equal((await f.charts.getStaff('b2c', actor, first.id)).assignedProductCount, 2);
  const page = await f.charts.list('b2c', actor, { limit: 1 });
  assert.equal(page.items[0].assignedProductCount, page.items[0].id === first.id ? 2 : 1);
  const detail = await f.products.getPublic('b2c', a.id, 'ar');
  assert.deepEqual(detail.sizeChart, { id: first.id, name: chartInput.name.ar, image: null, alt: chartInput.name.ar, measurements });
  assert.deepEqual((await f.products.getForHomepage([a.id], 'en'))[0].sizeChart.measurements, measurements);
  const changed = { unit: 'cm', rows: [{ size: 'XL', chest: 99.99, length: 80, sleeve: 61.01 }] };
  const update = await f.charts.update('b2c', actor, first.id, { version: 0, measurements: changed });
  assert.equal(update.assignedProductCount, 2);
  assert.equal((await f.products.getStaff('b2c', actor, a.id)).version, 0);
  assert.deepEqual((await f.products.getPublic('b2c', a.id, 'en')).sizeChart.measurements, changed);
  assert.equal((await f.products.getStaff('b2c', actor, b.id)).variants.length, 2, 'guide rows never create/filter variants');
  await f.products.update('b2c', actor, b.id, { version: 0, sizeChartId: second.id });
  assert.equal((await f.charts.getStaff('b2c', actor, first.id)).assignedProductCount, 1);
  assert.equal((await f.charts.getStaff('b2c', actor, second.id)).assignedProductCount, 2);
  assert.equal((await f.charts.getStaff('b2c', actor, first.id)).version, 1);
  await f.products.update('b2c', actor, a.id, { version: 0, sizeChartId: null });
  assert.equal((await f.charts.getStaff('b2c', actor, first.id)).assignedProductCount, 0);
  assert.equal((await f.products.getPublic('b2c', a.id, 'en')).sizeChart, null);
  assert.equal((await f.products.getStaff('b2c', actor, c.id)).sizeChartId, second.id);
  assert.equal((await f.products.getStaff('b2c', actor, d.id)).sizeChartId, null);
  await f.charts.remove('b2c', actor, first.id);
});

test('measurement validation has precise field paths and bounds; replacement, clear, shared edits and failed transactions preserve content', async () => {
  const f = sizechartsFixture(auth), chart = await f.charts.create('b2c', actor, { ...chartInput, measurements: measurementInput, isActive: true });
  const original = structuredClone(f.rows.get(chart.id));
  for (const measurements of [{}, { ...measurementInput, unit: 'in' }, { ...measurementInput, unknown: true }, { unit: 'cm', rows: [] },
    { unit: 'cm', rows: Array.from({ length: 51 }, (_, i) => ({ size: String(i), chest: 1, length: 1, sleeve: 1 })) },
    ...[null, '50', 0, -1, 1000.01, 50.001, Infinity, NaN, {}, true].map(chest => ({ unit: 'cm', rows: [{ size: 'S', chest, length: 1, sleeve: 1 }] })),
    { unit: 'cm', rows: [{ size: 'S', chest: 1, length: 1 }] },
    { unit: 'cm', rows: [{ size: 'S', chest: 1, length: 1, sleeve: 1 }, { size: ' s ', chest: 1, length: 1, sleeve: 1 }] },
    { unit: 'cm', rows: [{ size: 'x'.repeat(31), chest: 1, length: 1, sleeve: 1 }] },
    { unit: 'cm', rows: [{ size: 'S', chest: 1, length: 1, sleeve: 1, id: 'unexpected' }] }]) {
    await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, measurements }), error => error.code === 'VALIDATION_ERROR' && error.errors.length > 0);
    assert.deepEqual(f.rows.get(chart.id), original);
  }
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, measurements: null }), { code: 'VALIDATION_ERROR' });
  f.failAudit(true);
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, measurements: { unit: 'cm', rows: [{ size: 'XL', chest: 1000, length: 0.01, sleeve: 1.01 }] } }), /audit failed/);
  assert.deepEqual(f.rows.get(chart.id), original); f.failAudit(false);
  const results = await Promise.allSettled([1, 2].map(value => f.charts.update('b2c', actor, chart.id, { version: 0, measurements: { unit: 'cm', rows: [{ size: String(value), chest: value, length: value, sleeve: value }] } })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'SIZE_CHART_CONFLICT');
  const inactive = await f.charts.update('b2c', actor, chart.id, { version: 1, measurements: null, isActive: false });
  assert.equal(inactive.measurements, null); assert.deepEqual(inactive.images, { en: null, ar: null });
  assert.equal(normalizeMeasurements({ unit: 'cm', rows: [{ size: '30', chest: 0.29, length: 1000, sleeve: 0.01 }] }).rows[0].chest, 0.29);
  assert.equal(normalizeMeasurements({ unit: 'cm', rows: Array.from({ length: 50 }, (_, i) => ({ size: String(i), chest: 1, length: 1, sleeve: 1 })) }).rows.length, 50);
  await new SizeChart({ ...original, measurements: { unit: 'cm', rows: [{ size: '🧵'.repeat(30), chest: 1, length: 1, sleeve: 1 }] } }).validate();
});

test('legacy image charts remain public; mixed content can be cleared independently and never silently retires images', async () => {
  const f = sizechartsFixture(auth), chart = await f.charts.create('b2c', actor, chartInput);
  delete f.rows.get(chart.id).measurements;
  assert.equal((await f.charts.getStaff('b2c', actor, chart.id)).measurements, null);
  const uploaded = await f.charts.upload('b2c', actor, chart.id, 'en', await image(), 'image/png');
  await f.charts.update('b2c', actor, chart.id, { version: 0, imageIds: { en: uploaded.id }, isActive: true });
  await f.charts.update('b2c', actor, chart.id, { version: 1, measurements: measurementInput });
  assert.equal(f.m.rows.get(uploaded.id).status, 'attached');
  assert.equal((await f.charts.publicForProducts('b2c', [chart.id], 'en')).get(chart.id).image.id, uploaded.id);
  await f.charts.update('b2c', actor, chart.id, { version: 2, measurements: null });
  const imageOnly = (await f.charts.publicForProducts('b2c', [chart.id], 'ar')).get(chart.id);
  assert.equal(imageOnly.measurements, null); assert.equal(imageOnly.image.id, uploaded.id);
  await f.charts.update('b2c', actor, chart.id, { version: 3, measurements: measurementInput });
  await f.charts.update('b2c', actor, chart.id, { version: 4, imageIds: { en: null } });
  const numeric = (await f.charts.publicForProducts('b2c', [chart.id], 'ar')).get(chart.id);
  assert.equal(numeric.image, null); assert.ok(numeric.measurements); assert.equal(f.m.rows.has(uploaded.id), false);
});

test('charts start inactive, share across products, expose localized images/fallback and clear assignments', async () => {
  const f = sizechartsFixture(auth);
  const category = await f.p.categories.create('b2c', actor, { slug: 'shirts', name: { en: 'Shirts', ar: 'قمصان' } });
  const chart = await f.charts.create('b2c', actor, chartInput);
  assert.equal(chart.isActive, false); assert.equal(chart.version, 0); assert.deepEqual(chart.images, { en: null, ar: null });
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, isActive: true }), { code: 'VALIDATION_ERROR' });
  const upload = await f.charts.upload('b2c', actor, chart.id, 'en', await image(), 'image/png');
  const published = await f.charts.update('b2c', actor, chart.id, { version: 0, imageIds: { en: upload.id }, isActive: true, alt: { en: 'Chest in cm', ar: 'الصدر بالسنتيمتر' } });
  assert.equal(published.version, 1); assert.equal(f.m.rows.get(upload.id).status, 'attached');
  const first = await f.products.create('b2c', actor, { ...simpleInput(category.id), sizeChartId: chart.id });
  const second = await f.products.create('b2c', actor, { ...simpleInput(category.id, 'second'), sizeChartId: chart.id });
  assert.equal(first.sizeChartId, chart.id); assert.equal(second.sizeChartId, chart.id);
  const detail = await f.products.getPublic('b2c', first.id, 'ar');
  assert.deepEqual(detail.sizeChart, { id: chart.id, name: chartInput.name.ar, image: upload, alt: 'الصدر بالسنتيمتر', measurements: null });
  assert.equal(Object.hasOwn(detail, 'sizeChartId'), false);
  assert.equal((await f.products.browse('b2c', {}, 'en')).items.every(item => item.sizeChart?.id === chart.id), true);
  assert.equal(Object.hasOwn((await f.products.getForCart('b2c', [first.id]))[0], 'sizeChart'), false);
  await assert.rejects(f.charts.remove('b2c', actor, chart.id), { code: 'SIZE_CHART_IN_USE' });
  await f.charts.update('b2c', actor, chart.id, { version: 1, isActive: false });
  assert.equal((await f.products.getPublic('b2c', first.id, 'en')).sizeChart, null);
  const cleared = await f.products.update('b2c', actor, first.id, { version: 0, sizeChartId: null });
  assert.equal(cleared.sizeChartId, null);
  await f.products.update('b2c', actor, second.id, { version: 0, sizeChartId: null });
  await f.charts.remove('b2c', actor, chart.id);
  assert.equal(f.rows.size, 0); assert.equal(f.m.rows.has(upload.id), false); assert.equal(f.m.removals.length, 1);
});

test('chart assets are bound to chart and language, attachments expire, edits conflict, rollback preserves files', async () => {
  const f = sizechartsFixture(auth), chart = await f.charts.create('b2c', actor, chartInput);
  const other = await f.charts.create('b2c', actor, chartInput);
  const png = await image(), upload = await f.charts.upload('b2c', actor, chart.id, 'en', png, 'image/png');
  await assert.rejects(f.charts.update('b2c', actor, other.id, { version: 0, imageIds: { en: upload.id } }), { code: 'MEDIA_CONFLICT' });
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, imageIds: { ar: upload.id } }), { code: 'MEDIA_CONFLICT' });
  f.failAudit(true);
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, imageIds: { en: upload.id }, isActive: true }), /audit failed/);
  assert.equal(f.m.rows.get(upload.id).status, 'ready'); assert.equal(f.rows.get(chart.id).version, 0);
  f.failAudit(false);
  await f.charts.update('b2c', actor, chart.id, { version: 0, imageIds: { en: upload.id }, isActive: true });
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 0, isActive: false }), { code: 'SIZE_CHART_CONFLICT' });
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: 1, imageIds: { en: null } }), { code: 'VALIDATION_ERROR' });
  assert.equal(f.m.rows.get(upload.id).status, 'attached');
  const ar = await f.charts.upload('b2c', actor, chart.id, 'ar', png, 'image/png');
  await f.charts.update('b2c', actor, chart.id, { version: 1, imageIds: { ar: ar.id } });
  assert.equal((await f.charts.publicForProducts('b2c', [chart.id], 'ar')).get(chart.id).image.id, ar.id);
  const expired = await f.charts.upload('b2c', actor, other.id, 'en', png, 'image/png');
  f.m.advance(86400000);
  await assert.rejects(f.charts.update('b2c', actor, other.id, { version: 0, imageIds: { en: expired.id } }), { code: 'MEDIA_CONFLICT' });
  f.rows.get(chart.id).version = Number.MAX_SAFE_INTEGER;
  await assert.rejects(f.charts.update('b2c', actor, chart.id, { version: Number.MAX_SAFE_INTEGER, name: { en: 'New' } }), { code: 'SIZE_CHART_CONFLICT' });
});

test('catalog guard serializes assignment/deletion races without dangling chart IDs', async () => {
  for (const assignmentFirst of [true, false]) {
    const f = sizechartsFixture(auth), chart = await f.charts.create('b2c', actor, chartInput);
    const category = await f.p.categories.create('b2c', actor, { slug: 'root', name: { en: 'Root', ar: 'رئيسي' } });
    const product = await f.products.create('b2c', actor, simpleInput(category.id));
    const assign = () => f.products.update('b2c', actor, product.id, { version: 0, sizeChartId: chart.id });
    const remove = () => f.charts.remove('b2c', actor, chart.id);
    const result = await Promise.allSettled(assignmentFirst ? [assign(), remove()] : [remove(), assign()]);
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(result.find(row => row.status === 'rejected').reason.code, assignmentFirst ? 'SIZE_CHART_IN_USE' : 'SIZE_CHART_NOT_FOUND');
    const current = await f.products.getStaff('b2c', actor, product.id);
    assert.equal(current.sizeChartId, assignmentFirst ? chart.id : null);
    assert.equal(f.rows.has(chart.id), assignmentFirst);
  }
});

test('chart permissions, store restrictions, Mongo version guards and Bunny namespaces stay scoped', async () => {
  const f = sizechartsFixture(auth), chart = await f.charts.create('b2c', actor, chartInput);
  for (const role of ['moderator', 'user']) await assert.rejects(f.charts.getStaff('b2c', { ...actor, role }, chart.id), { code: 'FORBIDDEN' });
  await assert.rejects(f.charts.remove('b2c', { ...actor, role: 'admin' }, chart.id), { code: 'FORBIDDEN' });
  await assert.rejects(f.charts.create('b2b', actor, chartInput), { code: 'INVALID_STORE' });
  const query = sizechartsRepository.update('b2c', chart.id, 3, { isActive: false }, { marker: true });
  assert.equal(query.getFilter().store, 'b2c'); assert.equal(query.getFilter().version, 3); assert.equal(query.getUpdate().$inc.version, 1);
  const storage = createBunnyStorage({ zone: 'public', accessKey: 'synthetic-key', endpoint: 'https://storage.bunnycdn.com', cdnOrigin: 'https://assets.example.test' });
  for (const language of ['en', 'ar']) assert.match(storage.url(`narmer/b2c/catalog/size-chart-${language}/${chart.id}/${'b'.repeat(24)}.webp`), /https:\/\/assets/);
  for (const kind of ['size-chart-fr', 'homepage', '../product']) assert.throws(() => storage.url(`narmer/b2c/catalog/${kind}/${chart.id}/${'b'.repeat(24)}.webp`), { code: 'MEDIA_UNAVAILABLE' });
  assert.throws(() => storage.url(`narmer/b2b/catalog/size-chart-en/${chart.id}/${'b'.repeat(24)}.webp`), { code: 'MEDIA_UNAVAILABLE' });
});
