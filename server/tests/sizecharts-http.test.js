import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { identityFixture } from './helpers/identity.js';
import { sizechartsFixture, chartInput, measurementInput } from './helpers/sizecharts.js';
import { emptyHomepageRepository } from './helpers/homepage.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('size-chart HTTP covers all six operations, strict fields, version/image ownership and Product projections', async t => {
  const auth = identityFixture(), f = sizechartsFixture(auth.auth), { input } = await auth.verified();
  await auth.auth.provisionSuperAdmin('b2c', input.email);
  const token = (await auth.auth.login('b2c', input.email, input.password)).accessToken;
  const identity = await auth.auth.authenticate('b2c', token), tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const account = { ...input, email: `chart-${role}@example.test` };
    await auth.auth.register('b2c', account); await auth.auth.verifyEmail('b2c', account.email, auth.emails.at(-1).code);
    const user = await auth.users.findAccountByEmail('b2c', account.email); auth.accounts.get(user._id).role = role;
    tokens[role] = (await auth.auth.login('b2c', account.email, input.password)).accessToken;
  }
  const category = await f.p.categories.create('b2c', identity, { slug: 'root', name: { en: 'Root', ar: 'رئيسي' } });
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: auth.users, email: auth.email, repository: auth.repository, userRepository: auth.userRepository,
    categoryRepository: f.p.categoryRepository, productRepository: f.p.repository, chartRepository: f.repository,
    imageRepository: f.m.repository, storage: f.m.storage, transaction: f.transaction,
    submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository,
    favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository,
    discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    homeRepository: emptyHomepageRepository,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, { method = 'GET', body, raw, contentType = 'image/png', accessToken = token, locale = 'en' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(raw ? { 'Content-Type': contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...(await response.json()) };
  };
  const path = 'admin/b2c/size-charts';
  assert.equal((await request(path, { accessToken: null })).status, 401);
  for (const role of ['moderator', 'user']) assert.equal((await request(path, { accessToken: tokens[role] })).status, 403);
  for (const body of [{ ...chartInput, unknown: true }, { name: { en: 'Only one' } }, { ...chartInput, isActive: true },
    { name: { en: 'Test', ar: 'اختبار', fr: 'No' } }, { ...chartInput, isActive: 'false' }]) {
    assert.equal((await request(path, { method: 'POST', body })).status, 422);
  }
  const created = await request(path, { method: 'POST', body: chartInput, accessToken: tokens.admin });
  assert.equal(created.status, 201); const chart = created.data;
  assert.equal(chart.isActive, false); assert.equal(chart.version, 0);
  assert.equal((await request(`${path}/${chart.id}`)).data.id, chart.id);
  assert.equal((await request(`${path}?isActive=false&page=1&limit=1`)).data.pagination.total, 1);
  assert.equal((await request(`${path}/invalid`)).status, 422);
  assert.equal((await request(`${path}/${'f'.repeat(24)}`)).status, 404);
  assert.equal((await request('admin/b2b/size-charts')).status, 404);
  assert.equal((await request('b2c/size-charts')).status, 404);
  const patch = body => request(`${path}/${chart.id}`, { method: 'PATCH', body });
  for (const body of [{ isActive: false }, { version: '0', isActive: false }, { version: 0 },
    { version: 0, imageIds: {} }, { version: 0, imageIds: { fr: null } }, { version: 0, alt: { en: null } },
    { version: 0, name: { en: 'Okay', extra: 'No' } }, { version: 0, store: 'b2b' }]) assert.equal((await patch(body)).status, 422);
  const png = await sharp({ create: { width: 12, height: 25, channels: 3, background: 'white' } }).png().toBuffer();
  const uploadPath = `${path}/${chart.id}/images/en`;
  assert.equal((await request(uploadPath, { method: 'POST', raw: png, contentType: 'image/jpeg' })).status, 422);
  assert.equal((await request(uploadPath.replace('/en', '/fr'), { method: 'POST', raw: png })).status, 422);
  assert.equal((await request(uploadPath, { method: 'POST', raw: png, contentType: 'image/svg+xml' })).status, 415);
  assert.equal((await request(uploadPath, { method: 'POST', raw: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
  const uploaded = await request(uploadPath, { method: 'POST', raw: png, accessToken: tokens.admin });
  assert.equal(uploaded.status, 201); assert.deepEqual(Object.keys(uploaded.data).sort(), ['height', 'id', 'url', 'width']);
  assert.equal((await patch({ version: 0, imageIds: { ar: uploaded.data.id } })).status, 409);
  const published = await patch({ version: 0, imageIds: { en: uploaded.data.id }, isActive: true, alt: { en: 'Sizes in cm', ar: 'مقاسات بالسنتيمتر' } });
  assert.equal(published.status, 200); assert.equal(published.data.version, 1);
  assert.equal((await patch({ version: 0, isActive: false })).status, 409);
  const productPath = 'admin/b2c/products';
  const simple = await request(productPath, { method: 'POST', body: { ...simpleInput(category.id), sizeChartId: chart.id } });
  assert.equal(simple.status, 201); assert.equal(simple.data.sizeChartId, chart.id);
  const variant = await request(productPath, { method: 'POST', body: { ...variantInput(category.id), sizeChartId: chart.id } });
  assert.equal(variant.status, 201);
  for (const product of [simple.data, variant.data]) {
    const detail = await request(`b2c/products/${product.id}`, { locale: 'ar', accessToken: null });
    assert.equal(detail.data.sizeChart.name, chartInput.name.ar); assert.equal(detail.data.sizeChart.image.id, uploaded.data.id);
    assert.equal(Object.hasOwn(detail.data, 'sizeChartId'), false);
    assert.equal((await request(`${productPath}/${product.id}`)).data.sizeChartId, chart.id);
  }
  assert.equal((await request('b2c/products', { accessToken: null })).data.items.every(item => item.sizeChart?.id === chart.id), true);
  assert.equal((await request(`${path}/${chart.id}`, { method: 'DELETE', accessToken: tokens.admin })).status, 403);
  assert.equal((await request(`${path}/${chart.id}`, { method: 'DELETE' })).code, 'SIZE_CHART_IN_USE');
  for (const product of [simple.data, variant.data]) {
    const cleared = await request(`${productPath}/${product.id}`, { method: 'PATCH', body: { version: 0, sizeChartId: null } });
    assert.equal(cleared.status, 200); assert.equal(cleared.data.sizeChartId, null);
  }
  const deleted = await request(`${path}/${chart.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200); assert.equal(deleted.data, null);
  assert.equal((await request(`${path}?isActive=true`)).data.items.length, 0);
  assert.equal((await request(`b2c/products/${simple.data.id}`, { accessToken: null })).data.sizeChart, null);
  const numeric = await request(path, { method: 'POST', body: { ...chartInput, measurements: measurementInput, isActive: true } });
  assert.equal(numeric.status, 201); assert.equal(numeric.data.assignedProductCount, 0);
  assert.equal(numeric.data.measurements.rows[0].size, 'S'); assert.equal(numeric.data.images.en, null);
  const chartPath = `${path}/${numeric.data.id}`;
  const product = await request(productPath, { method: 'POST', body: { ...simpleInput(category.id, 'numeric-guide'), sizeChartId: numeric.data.id } });
  assert.equal(product.status, 201);
  assert.equal((await request(chartPath)).data.assignedProductCount, 1);
  const list = await request(path); assert.equal(list.data.items.find(item => item.id === numeric.data.id).assignedProductCount, 1);
  for (const locale of ['en', 'ar']) {
    const detail = await request(`b2c/products/${product.data.id}`, { accessToken: null, locale });
    assert.equal(detail.data.sizeChart.image, null); assert.equal(detail.data.sizeChart.measurements.rows[0].chest, 50.25);
    assert.equal((await request('b2c/products', { accessToken: null, locale })).data.items.find(item => item.id === product.data.id).sizeChart.measurements.unit, 'cm');
  }
  for (const body of [{ ...chartInput, assignedProductCount: 0 }, { ...chartInput, measurements: { ...measurementInput, extra: true } },
    { ...chartInput, measurements: { unit: 'in', rows: measurementInput.rows } },
    { ...chartInput, measurements: { unit: 'cm', rows: [{ size: 'S', chest: 50, length: 60 }] } },
    { ...chartInput, measurements: { unit: 'cm', rows: [{ size: 'S', chest: '50', length: 60, sleeve: 10 }] } },
    { ...chartInput, measurements: { unit: 'cm', rows: [{ size: 'S', chest: 50.001, length: 60, sleeve: 10 }] } }])
    assert.equal((await request(path, { method: 'POST', body })).status, 422);
  const invalid = await request(chartPath, { method: 'PATCH', body: { version: 0, measurements: { unit: 'cm', rows: [{ size: 'S', chest: 0, length: 1, sleeve: 1 }] } } });
  assert.equal(invalid.status, 422); assert.equal(invalid.errors[0].field, 'measurements.rows[0].chest');
  assert.equal((await request(chartPath)).data.version, 0);
  const saved = await request(chartPath, { method: 'PATCH', body: { version: 0, measurements: { unit: 'cm', rows: [{ size: 'L', chest: 56.75, length: 72, sleeve: 64 }] } } });
  assert.equal(saved.status, 200); assert.equal(saved.data.measurements.rows.length, 1); assert.equal(saved.data.version, 1);
  assert.equal((await request(chartPath, { method: 'PATCH', body: { version: 0, isActive: false } })).status, 409);
  assert.equal((await request(chartPath, { method: 'PATCH', body: { version: 1, measurements: null } })).status, 422);
  assert.equal((await request(chartPath, { method: 'PATCH', body: { version: 1, assignedProductCount: 99 } })).status, 422);
  const clearedNumeric = await request(chartPath, { method: 'PATCH', body: { version: 1, measurements: null, isActive: false } });
  assert.equal(clearedNumeric.status, 200); assert.equal(clearedNumeric.data.measurements, null); assert.equal(clearedNumeric.data.assignedProductCount, 1);
  assert.equal((await request(`b2c/products/${product.data.id}`, { accessToken: null })).data.sizeChart, null);
});
