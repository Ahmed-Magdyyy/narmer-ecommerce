import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import { emptyHomepageRepository } from './helpers/homepage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { productFixture, simpleInput, variantInput } from './helpers/products.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('Products HTTP validates money/options, preserves variants, limits staff actions and wires category blockers', async t => {
  const f = identityFixture();
  const p = productFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const token = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const identity = await f.auth.authenticate('b2c', token);
  const root = await p.categories.create('b2c', identity, { slug: 'clothing', name: { ar: 'ملابس', en: 'Clothing' } });
  const tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const account = { ...input, email: `${role}@example.com` };
    await f.auth.register('b2c', account, 'en');
    await f.auth.verifyEmail('b2c', account.email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', account.email);
    f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', account.email, account.password)).accessToken;
  }
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { homeRepository: emptyHomepageRepository, submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository, users: f.users, email: f.email,
    repository: f.repository, userRepository: f.userRepository, categoryRepository: p.categoryRepository,
    productRepository: p.repository, transaction: p.transaction,
    shoppingRepository: { async hasProductReferences() { return false; } } }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, { method = 'GET', accessToken, body, locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, result: await response.json() };
  }
  const path = 'admin/b2c/products';
  const body = simpleInput(root.id);
  assert.equal((await request(path, { method: 'POST', body })).status, 401);
  for (const role of ['moderator', 'user']) assert.equal((await request(path, { method: 'POST', body, accessToken: tokens[role] })).status, 403);
  for (const fields of [{ price: 2.5 }, { price: '25000' }, { price: null }, { stock: -1 }, { categoryId: { $ne: '' } }]) {
    assert.equal((await request(path, { method: 'POST', accessToken: tokens.admin, body: { ...body, ...fields } })).status, 422);
  }
  const created = await request(path, { method: 'POST', accessToken: tokens.admin, body: { ...body,
    sku: ' shirt-1 ', currency: 'USD', skuKeys: ['evil'], image: 'untrusted', store: 'b2b' } });
  assert.equal(created.status, 201);
  const product = created.result.data;
  assert.equal(product.currency, 'EGP');
  assert.equal(product.sku, 'SHIRT-1');
  assert.equal(Object.hasOwn(product, 'image'), false);
  assert.equal((await request('b2c/products', { locale: 'ar' })).result.data.items[0].name, 'قميص');
  assert.equal((await request('b2c/products?limit=101')).status, 422);
  assert.equal((await request('b2b/products')).status, 404);
  assert.equal((await request(`${path}/${product.id}`, { method: 'PATCH', accessToken: tokens.admin, body: { stock: 1 } })).status, 422);
  const patched = await request(`${path}/${product.id}`, { method: 'PATCH', accessToken: tokens.admin,
    body: { version: 0, discountedPrice: 20000 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.result.data.effectivePrice, 20000);
  assert.equal((await request(`${path}/${product.id}`, { method: 'PATCH', accessToken: tokens.admin, body: { version: 0, stock: 9 } })).status, 409);
  const variantCreated = await request(path, { method: 'POST', accessToken: token, body: variantInput(root.id) });
  assert.equal(variantCreated.status, 201);
  const variants = variantCreated.result.data;
  const renamed = await request(`${path}/${variants.id}`, { method: 'PATCH', accessToken: token, body: { version: 0, name: { ar: 'جديد' } } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.result.data.variants[0].id, variants.variants[0].id);
  const pricedList = await request('b2c/products?minPrice=25000&maxPrice=30000&size=42&sort=price-desc&limit=1');
  assert.equal(pricedList.status, 200);
  assert.equal(pricedList.result.data.pagination.total, 1);
  assert.equal(pricedList.result.data.items[0].matchingPrice, 30000);
  assert.equal(pricedList.result.data.items[0].matchingVariantId, variants.variants[1].id);
  const facets = await request('b2c/products/facets?minPrice=25000&maxPrice=30000&size=42', { locale: 'ar' });
  assert.equal(facets.status, 200);
  assert.equal(facets.result.data.applied.minPrice, 25000);
  assert.equal(facets.result.data.applied.maxPrice, 30000);
  assert.equal(facets.result.data.sizes.find(value => value.key === '42').name, '٤٢');
  const discounted = await request('b2c/products?saleOnly=true');
  assert.equal(discounted.result.data.items[0].id, product.id);
  assert.equal(discounted.result.data.items[0].matchingVariantId, null);
  assert.equal((await request('b2c/products?size=unknown')).result.data.items.length, 0);
  for (const query of ['minPrice=', 'minPrice=-1', 'minPrice=1.5', 'maxPrice=1000000001',
    'minPrice=30000&maxPrice=20000', 'size=Small', 'color=%7B%22evil%22%3A%22blue%22%7D', 'color=red&color=blue',
    'minPrice=1&minPrice=2', 'saleOnly=TRUE', 'saleOnly=1', 'sort=invalid']) {
    assert.equal((await request(`b2c/products?${query}`)).status, 422, query);
    if (!query.startsWith('sort=')) assert.equal((await request(`b2c/products/facets?${query}`)).status, 422, query);
  }
  assert.equal((await request(`${path}/${product.id}`, { method: 'DELETE', accessToken: tokens.admin })).status, 403);
  const blocked = await request(`admin/b2c/categories/${root.id}`, { method: 'DELETE', accessToken: token });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.result.code, 'CATEGORY_HAS_PRODUCTS');
  await request(`admin/b2c/categories/${root.id}`, { method: 'PATCH', accessToken: token, body: { isActive: false } });
  assert.equal((await request('b2c/products')).result.data.pagination.total, 0);
  assert.equal((await request(`b2c/products/${product.id}`)).status, 404);
  assert.equal((await request(`${path}/${product.id}`, { method: 'DELETE', accessToken: token })).status, 200);
});
