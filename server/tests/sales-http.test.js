import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { identityFixture } from './helpers/identity.js';
import { simpleInput } from './helpers/products.js';
import { cartFixture } from './helpers/cart.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { testConfig } from './helpers/config.js';

test('Sales HTTP validates fields and UTC schedules, whitelists input and restricts dashboard roles', async t => {
  const f = identityFixture(), p = cartFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const owner = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const identity = await f.auth.authenticate('b2c', owner);
  const category = await p.categories.create('b2c', identity, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const product = await p.products.create('b2c', identity, simpleInput(category.id));
  const tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const email = `${role}@example.com`;
    await f.auth.register('b2c', { ...input, email }, 'en');
    await f.auth.verifyEmail('b2c', email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', email);
    f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', email, input.password)).accessToken;
  }
  const s = salesFixture(f.auth, p);
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    categoryRepository: p.categoryRepository, productRepository: p.repository,
    shoppingRepository: p.cartRepository, campaignRepository: s.repository, transaction: s.transaction,
  }), isReady: () => true,
    logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'admin/b2c/sales', { method = 'GET', token = owner, body, locale = 'en', cookie } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, Origin: testConfig.corsOrigins[0], ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const body = { ...saleInput(product.id), startsAt: '2020-10-11T12:00:00Z', endsAt: '2099-10-12T12:00:00Z' };
  assert.equal((await request(undefined, { token: null })).status, 401);
  for (const role of ['moderator', 'user']) assert.equal((await request(undefined, { token: tokens[role] })).status, 403);
  for (const fields of [{ name: { ar: 'فقط' } }, { discountValue: '20' }, { discountValue: 1.5 }, { isEnabled: 'true' },
    { startsAt: '2026-02-30T12:00:00Z' }, { startsAt: '2026-10-11T12:00:00' }, { productIds: { $in: [product.id] } }]) {
    assert.equal((await request(undefined, { method: 'POST', body: { ...body, ...fields } })).status, 422);
  }
  const result = await request(undefined, { method: 'POST', token: tokens.admin, body: { ...body,
    startsAt: '2020-10-11T14:00:00+02:00', store: 'b2b', status: 'expired', currency: 'USD' }, locale: 'ar' });
  assert.equal(result.status, 201);
  assert.equal(result.data.data.status, 'active');
  assert.equal(result.data.data.startsAt, '2020-10-11T12:00:00.000Z');
  assert.equal(result.data.data.store, undefined);
  assert.equal(result.data.data.currency, 'EGP');
  const path = `admin/b2c/sales/${result.data.data.id}`;
  assert.equal((await request(undefined, { method: 'POST', body })).data.code, 'SALE_OVERLAP');
  const priced = await request(`b2c/products/${product.id}`, { token: null, locale: 'ar' });
  assert.equal(priced.data.data.effectivePrice, 20000);
  assert.equal(priced.data.data.activeSale.name, 'تخفيضات');
  assert.equal((await request(`admin/b2c/products/${product.id}`, { method: 'DELETE' })).data.code, 'PRODUCT_REFERENCED');
  const guest = await request('b2c/cart', { token: null });
  const cart = await request('b2c/cart/items', { method: 'PUT', token: null, cookie: guest.cookie, body: { productId: product.id, quantity: 2 } });
  assert.equal(cart.status, 200); assert.equal(cart.data.data.subtotal, 40000);
  assert.equal(cart.data.data.items[0].activeSale.id, result.data.data.id);
  assert.equal((await request(path, { method: 'DELETE', token: tokens.admin })).status, 403);
  assert.equal((await request(path, { method: 'PATCH', token: tokens.admin, body: { isEnabled: false } })).data.data.isEnabled, false);
  const restored = await request('b2c/cart', { token: null, cookie: guest.cookie });
  assert.equal(restored.data.data.subtotal, 50000); assert.equal(restored.data.data.items[0].activeSale, null);
  assert.equal((await request('admin/b2c/sales?isEnabled=false')).data.data.pagination.total, 1);
  assert.equal((await request(path, { method: 'PATCH', body: { status: 'active' } })).status, 422);
  assert.equal((await request('admin/b2c/sales?limit=101')).status, 422);
  assert.equal((await request('admin/b2b/sales')).status, 404);
  assert.equal((await request('b2c/sales')).status, 404);
  const deleted = await request(path, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.data, null);
});
