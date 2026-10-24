import { emptyLeadsRepository } from './helpers/leads.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { identityFixture } from './helpers/identity.js';
import { wholesaleFixture, nativeInput, offerInput } from './helpers/wholesale.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { createApp } from '../src/app/app.js';
import { testConfig } from './helpers/config.js';

test('Wholesale HTTP isolates both catalogs, roles, source selection, mixed pouches and B2B image ownership', async t => {
  const f = identityFixture(), p = wholesaleFixture(f.auth);
  const { input } = await f.verified('b2c');
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const b2cToken = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const b2c = await f.auth.authenticate('b2c', b2cToken);
  await f.auth.register('b2b', input, 'en'); await f.auth.verifyEmail('b2b', input.email, f.emails.at(-1).code);
  await f.auth.provisionSuperAdmin('b2b', input.email);
  const superToken = (await f.auth.login('b2b', input.email, input.password)).accessToken;
  async function account(role) {
    const email = `wholesale-${role}@example.com`;
    await f.auth.register('b2b', { ...input, email }, 'en'); await f.auth.verifyEmail('b2b', email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2b', email); f.accounts.get(user._id).role = role;
    return (await f.auth.login('b2b', email, input.password)).accessToken;
  }
  const adminToken = await account('admin'), moderator = await account('moderator'), customer = await account('user');
  const category = await p.categories.create('b2c', b2c, { slug: 'wholesale-source', name: { ar: 'ملابس', en: 'Clothing' } });
  const simple = await p.products.create('b2c', b2c, { ...simpleInput(category.id), stock: 0 });
  const variant = await p.products.create('b2c', b2c, variantInput(category.id));
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    productRepository: p.repository, categoryRepository: p.categoryRepository, transaction: p.transaction,
    offerRepository: p.wholesaleRepository, imageRepository: p.m.repository, storage: p.m.storage,
    shoppingRepository: { async hasProductReferences() { return false; } },
    orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository,
    campaignRepository: emptySalesRepository, favoritesRepository: emptyWishlistRepository,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, { method = 'GET', token, body, bytes, language = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(bytes ? { 'Content-Type': 'image/png' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(bytes ? { body: bytes } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const base = 'admin/b2b/wholesale';
  assert.equal((await request(`${base}/products`)).status, 401);
  for (const token of [moderator, customer]) assert.equal((await request(`${base}/products`, { token })).status, 403);
  assert.equal((await request(`${base}/products`, { token: b2cToken })).status, 401);
  assert.equal((await request('admin/b2c/wholesale/products', { token: b2cToken })).status, 404);
  const selected = await request(`${base}/b2c-products?q=Shirt&limit=1`, { token: adminToken });
  assert.equal(selected.status, 200); assert.equal(selected.body.data.pagination.total, 2);
  assert.equal(selected.body.data.items.length, 1);
  const source = (await request(`${base}/b2c-products/${simple.id}`, { token: adminToken })).body.data;
  assert.deepEqual(source.name, { ar: 'قميص', en: 'Shirt' });
  assert.ok(!Object.hasOwn(source, 'stock')); assert.ok(!Object.hasOwn(source, 'price'));
  const native = await request(`${base}/products`, { method: 'POST', token: adminToken, body: { ...nativeInput, ownerId: 'f'.repeat(24) } });
  assert.equal(native.status, 201); const nativeId = native.body.data.id;
  assert.equal((await request(`b2c/products/${nativeId}`)).status, 404);
  assert.equal((await request(`${base}/products`, { method: 'POST', token: adminToken, body: { ...nativeInput, stock: 1 } })).status, 422);
  const imageBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  const upload = await request(`admin/b2b/media/product/${nativeId}`, { method: 'POST', token: adminToken, bytes: imageBuffer });
  assert.equal(upload.status, 201); assert.match(p.m.uploads[0].key, /narmer\/b2b\//);
  assert.equal((await request(`admin/b2b/media/category/${nativeId}`, { method: 'POST', token: adminToken, bytes: imageBuffer })).status, 422);
  assert.equal((await request(`admin/b2b/media/product/${simple.id}`, { method: 'POST', token: adminToken, bytes: imageBuffer })).status, 404);
  assert.equal((await request(`${base}/products/${nativeId}`, { method: 'PATCH', token: adminToken,
    body: { version: 0, imageIds: [upload.body.data.id] } })).status, 200);
  const offer = await request(`${base}/offers`, { method: 'POST', token: adminToken, body: { ...offerInput('b2b', nativeId), isActive: true } });
  assert.equal(offer.status, 201); assert.equal(offer.body.data.piecesPerPouch, 30);
  assert.equal(offer.body.data.slug, 'wholesale-pouch');
  assert.deepEqual(offer.body.data.slugAliases, []);
  const offerId = offer.body.data.id;
  for (const key of ['wholesale-pouch', 'WHOLESALE-POUCH', offerId.toUpperCase()]) {
    const resolved = await request(`b2b/wholesale/offers/resolve/${key}`);
    assert.equal(resolved.status, 200); assert.equal(resolved.body.data.id, offerId);
  }
  for (const key of ['bad--key', 'a'.repeat(151), '%252f', 'bad%20key']) {
    const invalid = await request(`b2b/wholesale/offers/resolve/${key}`);
    assert.equal(invalid.status, 422); assert.equal(invalid.body.code, 'VALIDATION_ERROR');
    assert.equal(invalid.body.errors[0].field, 'offerKey'); assert.equal(invalid.body.errors[0].location, 'params');
  }
  assert.equal((await request('b2b/wholesale/offers/resolve/unknown-key')).status, 404);
  assert.equal((await request('b2b/wholesale/offers/wholesale-pouch')).status, 422);
  for (const body of [{ slug: 'custom-create' }, { slugAliases: [] }, { slug: null }]) {
    assert.equal((await request(`${base}/offers`, { method: 'POST', token: adminToken,
      body: { ...offerInput('b2b', nativeId), ...body } })).status, 422);
  }
  for (const body of [{ slug: null }, { slug: '' }, { slug: 'Upper' }, { slug: 'a'.repeat(24) }, { slug: 3 }, { slugAliases: [] }]) {
    const invalid = await request(`${base}/offers/${offerId}`, { method: 'PATCH', token: adminToken, body: { version: 0, ...body } });
    assert.equal(invalid.status, 422); assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  }
  for (const token of [moderator, customer, b2cToken]) assert.equal((await request(`${base}/offers/${offerId}`,
    { method: 'PATCH', token, body: { version: 0, slug: 'forbidden-change' } })).status, token === b2cToken ? 401 : 403);
  const moved = await request(`${base}/offers/${offerId}`, { method: 'PATCH', token: adminToken, body: { version: 0, slug: '  stable-offer  ' } });
  assert.equal(moved.status, 200); assert.equal(moved.body.data.slug, 'stable-offer');
  assert.deepEqual(moved.body.data.slugAliases, ['wholesale-pouch']);
  const alias = await request('b2b/wholesale/offers/resolve/wholesale-pouch');
  assert.equal(alias.status, 200); assert.deepEqual(alias.body.data, { ...moved.body.data,
    name: moved.body.data.name.en, description: moved.body.data.description.en,
    product: { ...moved.body.data.product, name: moved.body.data.product.name.en, description: moved.body.data.product.description.en } });
  for (const key of ['stable-offer', offerId]) assert.equal((await request(`b2b/wholesale/offers/resolve/${key}`)).body.data.slug, 'stable-offer');
  assert.equal((await request(`${base}/offers/${offerId}`, { token: adminToken })).body.data.slug, 'stable-offer');
  assert.equal((await request(`${base}/offers`, { token: adminToken })).body.data.items[0].slug, 'stable-offer');
  const nameEdit = await request(`${base}/offers/${offerId}`, { method: 'PATCH', token: adminToken, body: { version: 1, name: { en: 'Renamed pouch' } } });
  assert.equal(nameEdit.status, 200); assert.equal(nameEdit.body.data.slug, 'stable-offer');
  const conflict = await request(`${base}/offers/${offerId}`, { method: 'PATCH', token: adminToken, body: { version: 2, slug: 'wholesale-pouch' } });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'WHOLESALE_SLUG_EXISTS');
  assert.equal(Object.hasOwn(conflict.body, 'data'), false);
  const publicOffer = await request(`b2b/wholesale/offers/${offer.body.data.id}`, { language: 'ar' });
  assert.equal(publicOffer.status, 200); assert.equal(publicOffer.body.data.product.name, 'منتج الجملة');
  assert.equal(publicOffer.body.data.product.images.length, 1); assert.equal(publicOffer.body.data.version, 2);
  const mixed = await request(`${base}/offers`, { method: 'POST', token: adminToken,
    body: { ...offerInput('b2c', variant.id, variant.variants.map((row, i) => ({ variantId: row.id, quantity: i ? 20 : 10 }))), isActive: true } });
  assert.equal(mixed.status, 201); assert.equal(mixed.body.data.piecesPerPouch, 30);
  assert.equal((await request(`admin/b2c/products/${variant.id}`, { method: 'DELETE', token: b2cToken })).body.code, 'PRODUCT_REFERENCED');
  assert.equal((await request(`admin/b2c/products/${variant.id}`, { method: 'PATCH', token: b2cToken,
    body: { version: 0, variants: [variant.variants[0]] } })).body.code, 'PRODUCT_REFERENCED');
  assert.equal((await request(`${base}/products/${nativeId}`, { method: 'DELETE', token: adminToken })).status, 403);
  assert.equal((await request(`${base}/products/${nativeId}`, { method: 'DELETE', token: superToken })).body.code, 'WHOLESALE_REFERENCED');
  assert.equal((await request(`${base}/offers/${offer.body.data.id}`, { method: 'PATCH', token: adminToken,
    body: { version: 99, isActive: false } })).body.code, 'WHOLESALE_CONFLICT');
  assert.equal((await request(`${base}/offers/${offer.body.data.id}`, { method: 'DELETE', token: superToken })).status, 200);
  assert.equal((await request(`${base}/products/${nativeId}`, { method: 'DELETE', token: superToken })).status, 200);
  assert.equal(p.m.removals.length, 1);
  assert.equal((await request('b2b/wholesale/offers')).body.data.pagination.total, 1);
});
