import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { wishlistFixture } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { emptyHomepageRepository } from './helpers/homepage.js';
import { testConfig } from './helpers/config.js';

test('wishlist HTTP protects ownership, role/store boundaries, validation and product references', async t => {
  const f = identityFixture();
  const p = wishlistFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const staffToken = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const staff = await f.auth.authenticate('b2c', staffToken);
  const category = await p.categories.create('b2c', staff, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const simple = await p.products.create('b2c', staff, simpleInput(category.id));
  const variant = await p.products.create('b2c', staff, variantInput(category.id));
  async function account(email, store = 'b2c', role = 'user') {
    await f.auth.register(store, { ...input, email }, 'en');
    await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail(store, email);
    f.accounts.get(user._id).role = role;
    return { user, token: (await f.auth.login(store, email, input.password)).accessToken };
  }
  const customer = await account('wishlist-a@example.com');
  const other = await account('wishlist-b@example.com');
  const b2b = await account('wishlist-a@example.com', 'b2b');
  const moderator = await account('wishlist-moderator@example.com', 'b2c', 'moderator');
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { homeRepository: emptyHomepageRepository, submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    categoryRepository: p.categoryRepository, productRepository: p.repository,
    favoritesRepository: p.wishlistRepository, transaction: p.transaction,
    shoppingRepository: { async hasProductReferences() { return false; } },
    orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'b2c/wishlist', { method = 'GET', token = customer.token, body, locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  assert.deepEqual((await request()).body.data, { items: [], itemCount: 0 });
  assert.equal((await request(undefined, { token: null })).status, 401);
  for (const token of [staffToken, moderator.token]) assert.equal((await request(undefined, { token })).status, 403);
  assert.equal((await request(undefined, { token: b2b.token })).status, 401);
  assert.equal((await request('b2b/wishlist', { token: b2b.token })).status, 404);
  assert.equal((await request('admin/b2c/wishlist', { token: staffToken })).status, 404);
  const invalid = await request('b2c/wishlist/items/invalid', { method: 'PUT' });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.errors[0].field, 'productId');
  assert.equal(invalid.body.errors[0].location, 'params');
  assert.equal((await request(`b2c/wishlist/items/${'a'.repeat(24)}`, { method: 'PUT' })).status, 404);
  const added = await request(`b2c/wishlist/items/${simple.id.toUpperCase()}`, { method: 'PUT', locale: 'ar',
    body: { userId: other.user._id, productId: variant.id, price: 1, store: 'b2b' } });
  assert.equal(added.status, 200);
  assert.equal(added.body.data.items[0].productId, simple.id);
  assert.equal(added.body.data.items[0].product.name, 'قميص');
  assert.equal(added.cookie, null);
  assert.equal((await request(undefined, { token: other.token })).body.data.itemCount, 0);
  assert.equal((await request(`b2c/wishlist/items/${simple.id}`, { method: 'PUT' })).body.data.itemCount, 1);
  assert.equal((await request(`admin/b2c/products/${simple.id}`, { method: 'DELETE', token: staffToken })).body.code, 'PRODUCT_REFERENCED');
  await request(`b2c/wishlist/items/${variant.id}`, { method: 'PUT' });
  assert.equal((await request(`admin/b2c/products/${variant.id}`, { method: 'PATCH', token: staffToken,
    body: { version: 0, variants: [variant.variants[0]] } })).status, 200);
  await request(`admin/b2c/products/${simple.id}`, { method: 'PATCH', token: staffToken, body: { version: 0, isActive: false } });
  const hidden = (await request()).body.data.items[0];
  assert.deepEqual(hidden, { productId: simple.id, product: null, status: 'unavailable' });
  await request(`b2c/wishlist/items/${simple.id}`, { method: 'DELETE' });
  assert.equal((await request(`admin/b2c/products/${simple.id}`, { method: 'DELETE', token: staffToken })).status, 200);
  assert.equal((await request(`b2c/wishlist/items/${simple.id}`, { method: 'DELETE' })).body.data.itemCount, 1);
  assert.deepEqual((await request(undefined, { method: 'DELETE' })).body.data, { items: [], itemCount: 0 });
  f.accounts.get(customer.user._id).status = 'blocked';
  assert.equal((await request()).status, 401);
});
