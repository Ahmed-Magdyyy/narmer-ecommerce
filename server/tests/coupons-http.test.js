import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { identityFixture } from './helpers/identity.js';
import { cartFixture } from './helpers/cart.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { couponsFixture, couponInput } from './helpers/coupons.js';
import { simpleInput } from './helpers/products.js';
import { testConfig } from './helpers/config.js';

test('Coupons HTTP wires dashboard CRUD, guest/account preview, scopes, sale exclusions, limits and safe input', async t => {
  const f = identityFixture(), p = cartFixture(f.auth), s = salesFixture(f.auth, p);
  const c = couponsFixture(f.auth, { ...p, sales: s.sales, transaction: s.transaction });
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const owner = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const identity = await f.auth.authenticate('b2c', owner);
  const tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const email = `${role}@example.com`;
    await f.auth.register('b2c', { ...input, email }, 'en');
    await f.auth.verifyEmail('b2c', email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', email); f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', email, input.password)).accessToken;
  }
  const category = await c.categories.create('b2c', identity, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const product = await c.products.create('b2c', identity, simpleInput(category.id));
  const second = await c.products.create('b2c', identity, simpleInput(category.id, 'second'));
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, users: f.users, email: f.email,
    repository: f.repository, userRepository: f.userRepository, categoryRepository: p.categoryRepository,
    productRepository: p.repository, shoppingRepository: p.cartRepository, campaignRepository: s.repository,
    discountRepository: c.repository, transaction: c.transaction }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'admin/b2c/coupons', { method = 'GET', token = owner, body, cookie, origin = testConfig.corsOrigins[0], locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}),
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, result: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request(undefined, { token: null })).status, 401);
  for (const role of ['moderator', 'user']) assert.equal((await request(undefined, { token: tokens[role] })).status, 403);
  for (const fields of [{ code: { $ne: '' } }, { maxUses: 0 }, { maxUsesPerPerson: '1' }, { minimumSpend: -1 },
    { startsAt: '2026-02-30T12:00:00Z' }, { endsAt: '2026-10-12T12:00:00' }, { isEnabled: 1 }]) {
    assert.equal((await request(undefined, { method: 'POST', body: couponInput(fields) })).status, 422);
  }
  const created = await request(undefined, { method: 'POST', token: tokens.admin,
    body: couponInput({ code: ' welcome20 ', minimumSpend: 50000, maxUses: 2, maxUsesPerPerson: 1, usedCount: 99,
      startsAt: '2020-10-11T14:00:00+02:00', endsAt: '2099-10-12T12:00:00Z', store: 'b2b', currency: 'USD' }) });
  assert.equal(created.status, 201); assert.equal(created.result.data.usedCount, 0); assert.equal(created.result.data.code, 'WELCOME20');
  assert.equal(created.result.data.startsAt, '2020-10-11T12:00:00.000Z');
  const path = `admin/b2c/coupons/${created.result.data.id}`;
  assert.equal((await request(path, { method: 'PATCH', body: { startsAt: null, endsAt: null } })).result.data.startsAt, null);
  assert.equal((await request(path, { method: 'PATCH', body: { usedCount: 100 } })).status, 422);
  assert.equal((await request(path, { method: 'DELETE', token: tokens.admin })).status, 403);
  assert.equal((await request(undefined, { method: 'POST', body: couponInput() })).result.code, 'COUPON_CODE_EXISTS');
  const guest = await request('b2c/cart', { token: null });
  await request('b2c/cart/items', { method: 'PUT', token: null, cookie: guest.cookie, body: { productId: product.id, quantity: 2 } });
  const previewPath = 'b2c/cart/coupon-preview', previewBody = { code: 'welcome20', phone: '+20 (100) 123-4567' };
  assert.equal((await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: previewBody, origin: null })).status, 403);
  assert.equal((await request(previewPath, { method: 'POST', token: tokens.admin, body: previewBody })).status, 403);
  assert.equal((await request(previewPath, { method: 'POST', token: 'invalid', body: previewBody })).status, 401);
  assert.equal((await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: { code: 'WELCOME20' } })).status, 422);
  const preview = await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, locale: 'ar',
    body: { ...previewBody, subtotal: 1, discountAmount: 50000, allocations: [], userId: 'f'.repeat(24) } });
  assert.equal(preview.status, 200); assert.equal(preview.result.data.discountAmount, 10000);
  assert.equal(preview.result.data.coupon.name, 'خصم ترحيبي'); assert.equal(preview.result.data.subtotalAfterDiscount, 40000);
  assert.equal((await request(path)).result.data.usedCount, 0);
  await s.sales.create('b2c', identity, { ...saleInput(product.id), startsAt: '2020-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' });
  assert.equal((await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: previewBody })).result.code, 'COUPON_NO_ELIGIBLE_ITEMS');
  await request('b2c/cart/items', { method: 'PUT', token: null, cookie: guest.cookie, body: { productId: second.id, quantity: 1 } });
  assert.equal((await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: previewBody })).result.code, 'COUPON_MINIMUM_SPEND');
  await request(path, { method: 'PATCH', token: tokens.admin, body: { targetType: 'products', productIds: [second.id], minimumSpend: 25000 } });
  const mixed = await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: previewBody });
  assert.equal(mixed.result.data.discountAmount, 5000); assert.deepEqual(mixed.result.data.allocations.map(row => row.discountAmount), [0, 5000]);
  const cartBefore = await request('b2c/cart', { token: null, cookie: guest.cookie });
  assert.equal(cartBefore.result.data.subtotal, 65000); assert.equal(cartBefore.result.data.coupon, undefined);
  const sourceOwner = { guestToken: guest.cookie.split('=')[1] };
  await c.transaction(session => c.coupons.redeem('b2c', sourceOwner, 'WELCOME20', '01001234567', { session, orderId: '3'.repeat(24), at: c.now() }));
  assert.equal((await request(previewPath, { method: 'POST', token: null, cookie: guest.cookie, body: previewBody })).result.code, 'COUPON_PERSON_LIMIT_REACHED');
  await request('b2c/cart/items', { method: 'PUT', token: tokens.user, body: { productId: second.id, quantity: 1 } });
  assert.equal((await request(previewPath, { method: 'POST', token: tokens.user, body: previewBody })).result.code, 'COUPON_PERSON_LIMIT_REACHED');
  assert.equal((await request(previewPath, { method: 'POST', token: tokens.user, body: { ...previewBody, phone: '+201009876543' } })).status, 200);
  assert.equal((await request(path, { method: 'DELETE' })).result.code, 'COUPON_REFERENCED');
  assert.equal((await request('admin/b2c/coupons?limit=101')).status, 422);
  assert.equal((await request('admin/b2b/coupons')).status, 404); assert.equal((await request('b2c/coupons')).status, 404);
  const disposable = await request(undefined, { method: 'POST', body: couponInput({ code: 'DISPOSABLE', isEnabled: false }) });
  const removed = await request(`admin/b2c/coupons/${disposable.result.data.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200); assert.equal(removed.result.data, null);
});
