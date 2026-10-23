import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { identityFixture } from './helpers/identity.js';
import { homepageFixture } from './helpers/homepage.js';
import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('homepage HTTP covers eight operations, binary ownership, staff/store scope, versioned edits and retail projections', async t => {
  const auth = identityFixture(), f = homepageFixture(auth.auth), tokens = {};
  for (const store of ['b2c', 'b2b']) {
    const { input } = await auth.verified(store); await auth.auth.provisionSuperAdmin(store, input.email);
    tokens[store] = (await auth.auth.login(store, input.email, input.password)).accessToken;
    for (const role of ['admin', 'moderator', 'user']) {
      const account = { ...input, email: `home-${role}@example.test` };
      await auth.auth.register(store, account); await auth.auth.verifyEmail(store, account.email, auth.emails.at(-1).code);
      const user = await auth.users.findAccountByEmail(store, account.email); auth.accounts.get(user._id).role = role;
      tokens[`${store}-${role}`] = (await auth.auth.login(store, account.email, input.password)).accessToken;
    }
  }
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: auth.users, email: auth.email, repository: auth.repository, userRepository: auth.userRepository,
    homeRepository: f.repository, categoryRepository: f.p.categoryRepository, productRepository: f.p.repository,
    shoppingRepository: { async hasProductReferences() { return false; } },
    imageRepository: f.m.repository, storage: f.m.storage, transaction: f.transaction,
    submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository,
    favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository,
    discountRepository: emptyCouponsRepository, campaignRepository: f.s.repository,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, { method = 'GET', body, raw, contentType = 'image/png', token, language = 'en' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(raw ? { 'Content-Type': contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, ...(await response.json()) };
  };
  const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: 'white' } }).png().toBuffer();
  const category = await request('admin/b2c/categories', { method: 'POST', token: tokens.b2c,
    body: { slug: 'home', name: { en: 'Home clothing', ar: 'ملابس' } } });
  assert.equal(category.status, 201);
  const product = await request('admin/b2c/products', { method: 'POST', token: tokens.b2c,
    body: { ...simpleInput(category.data.id, 'home-shirt'), discountedPrice: 20000 } });
  const variant = await request('admin/b2c/products', { method: 'POST', token: tokens.b2c, body: variantInput(category.data.id, 'home-variants') });
  assert.equal(product.status, 201); assert.equal(variant.status, 201);
  for (const store of ['b2c', 'b2b']) {
    const path = `admin/${store}/homepage`, key = store === 'b2c' ? 'hero-left' : 'hero', token = tokens[store];
    const initial = await request(`${store}/homepage`); assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'no-store'); assert.equal(initial.data.updatedAt, null);
    assert.equal(initial.data.slots.length, store === 'b2c' ? 6 : 7);
    assert.equal(Object.hasOwn(initial.data, 'version'), false);
    const staff = await request(path, { token }); assert.equal(staff.data.version, 0);
    assert.ok(staff.data.allowedSlots.every(slot => slot.supportsMobileImage));
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { token: tokens[store === 'b2c' ? 'b2b' : 'b2c'] })).status, 401);
    for (const role of ['moderator', 'user']) for (const method of ['GET', 'PATCH', 'POST']) {
      const result = await request(method === 'POST' ? `${path}/media/${key}/desktop` : path,
        { method, token: tokens[`${store}-${role}`], ...(method === 'PATCH' ? { body: { version: 0, slots: [{ key, alt: { en: 'x' } }] } } : {}) });
      assert.equal(result.status, 403); assert.equal(result.headers.get('cache-control'), 'no-store');
    }
    const patch = body => request(path, { method: 'PATCH', token, body });
    for (const body of [{ version: 0 }, { version: '0', slots: [] }, { version: 0, slots: [] },
      { version: 0, slots: [{ key, alt: { en: 'x' }, link: '/arbitrary' }] }, { version: 0, slots: [{ key, alt: { fr: 'x' } }] },
      { version: 0, slots: [{ key: 'unknown', desktopImageId: null }] }, { version: 0, allowedSlots: [] },
      { version: 0, title: 'No arbitrary content' }]) assert.equal((await patch(body)).status, 422);
    if (store === 'b2b') assert.equal((await patch({ version: 0, newArrivals: { productIds: [] } })).status, 422);
    const upload = `${path}/media/${key}/desktop`;
    assert.equal((await request(upload, { method: 'POST', token, raw: png, contentType: 'image/jpeg' })).status, 422);
    assert.equal((await request(upload, { method: 'POST', token, raw: png, contentType: 'image/svg+xml' })).status, 415);
    assert.equal((await request(upload, { method: 'POST', token, raw: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
    assert.equal((await request(`${path}/media/unknown/desktop`, { method: 'POST', token, raw: png })).status, 422);
    assert.equal((await request(`${path}/media/${key}/tablet`, { method: 'POST', token, raw: png })).status, 422);
    const image = await request(upload, { method: 'POST', token: tokens[`${store}-admin`], raw: png });
    assert.equal(image.status, 201); assert.deepEqual(Object.keys(image.data).sort(), ['id', 'url', 'width', 'height'].sort());
    assert.equal((await patch({ version: 0, slots: [{ key, mobileImageId: image.data.id }] })).code, 'MEDIA_CONFLICT');
    const body = { version: 0, slots: [{ key, desktopImageId: image.data.id, alt: { en: 'Shared campaign image', ar: 'صورة الحملة' } }],
      ...(store === 'b2c' ? { newArrivals: { productIds: [variant.data.id, product.data.id] }, sale: { productIds: [variant.data.id, product.data.id] } } : {}) };
    const saved = await request(path, { method: 'PATCH', token: tokens[`${store}-admin`], body });
    assert.equal(saved.status, 200); assert.equal(saved.data.version, 1);
    assert.deepEqual((await request(path, { token })).data, saved.data);
    assert.equal((await patch(body)).code, 'HOMEPAGE_CONFLICT');
    const publicHome = await request(`${store}/homepage`, { language: 'ar' });
    assert.equal(publicHome.data.slots[0].desktopImage.id, image.data.id); assert.equal(publicHome.data.slots[0].mobileImage, null);
    assert.equal(publicHome.data.slots[0].alt, 'صورة الحملة');
    if (store === 'b2c') {
      assert.deepEqual(publicHome.data.newArrivals.items.map(item => item.id), [variant.data.id, product.data.id]);
      assert.deepEqual(publicHome.data.sale.items.map(item => item.id), [product.data.id]);
      assert.deepEqual(saved.data.sale.visibleProductIds, [product.data.id]);
      assert.equal((await request(`admin/b2c/products/${product.data.id}`, { method: 'DELETE', token })).code, 'PRODUCT_REFERENCED');
      const campaign = await request('admin/b2c/sales', { method: 'POST', token, body: {
        name: { en: 'Homepage campaign', ar: 'حملة الصفحة الرئيسية' }, targetType: 'products', productIds: [variant.data.id, product.data.id],
        discountType: 'percentage', discountValue: 20, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(),
      } });
      assert.equal(campaign.status, 201);
      const currentSale = await request('b2c/homepage', { language: 'ar' });
      assert.deepEqual(currentSale.data.sale.items.map(item => item.id), [variant.data.id, product.data.id]);
      assert.equal(currentSale.data.sale.items[0].variants[0].activeSale.id, campaign.data.id);
      assert.equal((await request(`b2c/products/${variant.data.id}`)).data.variants[0].activeSale.id, campaign.data.id);
      assert.equal((await request(`b2c/products/${product.data.id}`)).data.activeSale.id, campaign.data.id);
      assert.equal((await request('b2c/products')).status, 200);
      await request('admin/b2c/sales/' + campaign.data.id, { method: 'DELETE', token });
    }
    const mobile = await request(`${path}/media/${key}/mobile`, { method: 'POST', token, raw: png });
    const replaced = await patch({ version: 1, slots: [{ key, desktopImageId: null, mobileImageId: mobile.data.id, alt: { ar: '' } }] });
    assert.equal(replaced.status, 200); assert.equal(replaced.data.version, 2);
    assert.equal((await request(`${store}/homepage`, { language: 'ar' })).data.slots[0].alt, 'Shared campaign image');
    assert.equal((await request(path, { token })).data.slots[0].desktopImage, null);
  }
  const cleared = await request('admin/b2c/homepage', { method: 'PATCH', token: tokens.b2c,
    body: { version: 2, newArrivals: { productIds: [] }, sale: { productIds: [] } } });
  assert.equal(cleared.status, 200);
  assert.equal((await request(`admin/b2c/products/${product.data.id}`, { method: 'DELETE', token: tokens.b2c })).status, 200);
  assert.equal((await request('b2c/homepage')).data.sale.items.length, 0);
  assert.equal((await request('admin/b2c/media/homepage-desktop/' + 'a'.repeat(24), { method: 'POST', token: tokens.b2c, raw: png })).status, 422);
});
