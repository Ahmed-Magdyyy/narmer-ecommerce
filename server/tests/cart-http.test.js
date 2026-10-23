import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { cartFixture } from './helpers/cart.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('cart HTTP protects guest cookies, customer ownership, merge retries and catalogue deletion', async t => {
  const f = identityFixture();
  const p = cartFixture(f.auth);
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
  const customer = await account('cart-user@example.com');
  const other = await account('cart-other@example.com');
  const b2b = await account('cart-user@example.com', 'b2b');
  const moderator = await account('cart-moderator@example.com', 'b2c', 'moderator');
  const config = { ...testConfig, nodeEnv: 'production' };
  const app = createApp(config, { apiRouter: createBusinessRouter(config, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    categoryRepository: p.categoryRepository, productRepository: p.repository,
    shoppingRepository: p.cartRepository, transaction: p.transaction,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'b2c/cart', { method = 'GET', token, cookie, body, origin = 'https://shop.example', locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(origin ? { Origin: origin } : {}),
        ...(token !== undefined ? { Authorization: token ? `Bearer ${token}` : '' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, result: await response.json(), setCookie: response.headers.get('set-cookie') };
  }
  const empty = await request();
  const cookie = empty.setCookie.split(';')[0];
  assert.match(empty.setCookie, /HttpOnly/);
  assert.match(empty.setCookie, /Secure/);
  assert.match(empty.setCookie, /SameSite=Lax/);
  assert.match(empty.setCookie, /Max-Age=2592000/);
  assert.match(empty.setCookie, /Path=\/api\/v1\/b2c\/cart/);
  assert.equal(p.cartRows.size, 1);
  assert.deepEqual(empty.result.data, { items: [], itemCount: 0, subtotal: 0, currency: 'EGP', canCheckout: false });
  assert.equal((await request('b2c/cart', { cookie })).status, 200);
  assert.equal(p.cartRows.size, 1);
  const secondCookie = (await request()).setCookie.split(';')[0];
  const selected = { productId: simple.id, quantity: 2 };
  assert.equal((await request('b2c/cart/items', { method: 'PUT', body: selected, cookie, origin: null })).status, 403);
  assert.equal((await request('b2c/cart/items', { method: 'PUT', body: selected, cookie, origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('', { token: '' })).status, 404);
  assert.equal((await request('b2c/cart', { token: '' })).status, 401);
  assert.equal((await request('b2c/cart', { token: b2b.token })).status, 401);
  assert.equal((await request('b2c/cart', { token: staffToken })).status, 403);
  assert.equal((await request('b2c/cart', { token: moderator.token })).status, 403);
  assert.equal((await request('b2c/cart', { cookie: `${cookie}; ${cookie}` })).status, 401);
  assert.equal((await request('b2c/cart', { cookie: 'narmer_cart_b2c=invalid' })).status, 401);
  for (const quantity of [-1, 0.5, '2', null, 10001]) {
    assert.equal((await request('b2c/cart/items', { method: 'PUT', cookie, body: { ...selected, quantity } })).status, 422);
  }
  const added = await request('b2c/cart/items', { method: 'PUT', cookie, locale: 'ar',
    body: { ...selected, productId: simple.id.toUpperCase(), ownerKey: `u:${customer.user._id}`, unitPrice: 1, store: 'b2b' } });
  assert.equal(added.status, 200);
  assert.equal(added.result.data.items[0].name, 'قميص');
  assert.equal(added.result.data.subtotal, 50000);
  assert.equal((await request('b2c/cart', { cookie: secondCookie })).result.data.items.length, 0);
  assert.equal((await request('b2c/cart', { token: customer.token, cookie })).result.data.items.length, 0);
  assert.equal((await request(`admin/b2c/products/${simple.id}`, { method: 'DELETE', token: staffToken })).result.code, 'PRODUCT_REFERENCED');
  const variantSelection = { productId: variant.id, variantId: variant.variants[0].id, quantity: 1 };
  assert.equal((await request('b2c/cart/items', { method: 'PUT', cookie, body: variantSelection })).status, 200);
  assert.equal((await request(`admin/b2c/products/${variant.id}`, { method: 'PATCH', token: staffToken,
    body: { version: 0, variants: [variant.variants[1]] } })).result.code, 'PRODUCT_REFERENCED');
  assert.equal((await request('b2c/cart/items', { method: 'PUT', token: customer.token, body: { ...selected, quantity: 1 } })).status, 200);
  assert.equal((await request('b2c/cart/merge', { method: 'POST', token: customer.token, cookie, origin: null })).status, 403);
  const merged = await request('b2c/cart/merge', { method: 'POST', token: customer.token, cookie });
  assert.equal(merged.status, 200);
  assert.equal(merged.result.data.itemCount, 4);
  assert.match(merged.setCookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('b2c/cart/merge', { method: 'POST', token: customer.token, cookie })).result.data.itemCount, 4);
  assert.equal((await request('b2c/cart', { cookie })).result.data.items.length, 0);
  assert.equal((await request('b2c/cart', { token: other.token })).result.data.items.length, 0);
  await request('b2c/cart/items', { method: 'PUT', cookie: secondCookie, body: { ...selected, quantity: 8 } });
  const failed = await request('b2c/cart/merge', { method: 'POST', token: customer.token, cookie: secondCookie });
  assert.equal(failed.result.code, 'CART_MERGE_UNAVAILABLE');
  assert.equal(failed.setCookie, null);
  assert.equal((await request('b2c/cart', { cookie: secondCookie })).result.data.items[0].quantity, 8);
  assert.equal((await request('b2c/cart', { token: customer.token })).result.data.itemCount, 4);
  await request('b2c/cart/items', { method: 'PUT', token: customer.token, body: { productId: simple.id, quantity: 0 } });
  await request('b2c/cart', { method: 'DELETE', token: customer.token });
  assert.equal((await request('b2c/cart', { token: customer.token })).result.data.items.length, 0);
  f.accounts.get(customer.user._id).status = 'blocked';
  assert.equal((await request('b2c/cart', { token: customer.token })).status, 401);
  assert.equal((await request('b2b/cart')).status, 404);
  assert.equal((await request('admin/b2c/cart', { token: staffToken })).status, 404);
});
