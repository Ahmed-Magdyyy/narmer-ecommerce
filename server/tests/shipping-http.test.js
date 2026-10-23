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
import { shippingFixture } from './helpers/shipping.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('Shipping HTTP provides localized quotes, safe defaults and the admin deletion exception with strict money validation', async t => {
  const f = identityFixture();
  const s = shippingFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const token = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const account = { ...input, email: `shipping-${role}@example.com` };
    await f.auth.register('b2c', account, 'en');
    await f.auth.verifyEmail('b2c', account.email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', account.email);
    f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', account.email, account.password)).accessToken;
  }
  const b2bAccount = { ...input, email: 'shipping-b2b@example.com' };
  await f.auth.register('b2b', b2bAccount, 'en');
  await f.auth.verifyEmail('b2b', b2bAccount.email, f.emails.at(-1).code);
  const b2bToken = (await f.auth.login('b2b', b2bAccount.email, b2bAccount.password)).accessToken;
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    deliveryRepository: s.repository, transaction: s.transaction,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, { method = 'GET', accessToken, body, locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, result: await response.json() };
  }
  const path = 'admin/b2c/shipping-fees';
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { accessToken: b2bToken })).status, 401);
  for (const role of ['moderator', 'user']) {
    assert.equal((await request(path, { accessToken: tokens[role] })).status, 403);
    assert.equal((await request(`${path}/default`, { method: 'PATCH', accessToken: tokens[role], body: { defaultFee: 1 } })).status, 403);
  }
  assert.equal((await request(`${path}/default`, { accessToken: tokens.admin })).result.data.configured, false);
  assert.equal((await request('b2c/shipping-fees/quote?governorateCode=giza')).status, 503);
  for (const value of [-1, 1.5, '5000', null]) {
    assert.equal((await request(`${path}/default`, { method: 'PATCH', accessToken: tokens.admin, body: { defaultFee: value } })).status, 422);
  }
  assert.equal((await request(`${path}/default`, { method: 'PATCH', accessToken: tokens.admin, body: { defaultFee: 8000 } })).status, 200);
  const payload = { governorateCode: 'Cairo', name: { ar: 'القاهرة', en: 'Cairo' }, fee: 0 };
  const created = await request(path, { method: 'POST', accessToken: tokens.admin, body: { ...payload, store: 'b2b', currency: 'USD' } });
  assert.equal(created.status, 201);
  const row = created.result.data;
  assert.equal(row.governorateCode, 'cairo');
  assert.equal(row.currency, 'EGP');
  assert.equal(row.store, undefined);
  assert.equal((await request(path, { method: 'POST', accessToken: token, body: payload })).result.code, 'SHIPPING_FEE_EXISTS');
  const quote = await request('b2c/shipping-fees/quote?governorateCode=CAIRO', { locale: 'ar' });
  assert.equal(quote.result.data.name, 'القاهرة');
  assert.equal(quote.result.data.fee, 0);
  assert.equal(quote.result.data.source, 'override');
  assert.equal((await request(`${path}/${row.id}`, { method: 'PATCH', accessToken: token, body: { governorateCode: 'giza', fee: 1 } })).result.code, 'SHIPPING_CODE_IMMUTABLE');
  const updated = await request(`${path}/${row.id}`, { method: 'PATCH', accessToken: tokens.admin, body: { name: { en: 'Greater Cairo' }, fee: 7000 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.result.data.name.ar, 'القاهرة');
  assert.equal((await request('b2c/shipping-fees?limit=100', { locale: 'en' })).result.data.items[0].name, 'Greater Cairo');
  assert.equal((await request('b2c/shipping-fees?limit=101')).status, 422);
  assert.equal((await request(`${path}/default`, { method: 'DELETE', accessToken: tokens.admin })).status, 422);
  assert.equal((await request(`${path}/${row.id}`, { method: 'DELETE', accessToken: tokens.moderator })).status, 403);
  assert.equal((await request(`${path}/${row.id}`, { method: 'DELETE', accessToken: tokens.admin })).status, 200);
  assert.equal((await request('b2c/shipping-fees/quote?governorateCode=cairo')).result.data.fee, 8000);
  assert.equal((await request(`${path}/${row.id}`, { accessToken: token })).status, 404);
  assert.equal((await request('b2b/shipping-fees')).status, 404);
  assert.equal((await request('admin/b2b/shipping-fees', { accessToken: b2bToken })).status, 404);
});
