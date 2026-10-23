import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { identityFixture } from './helpers/identity.js';
import { categoryFixture } from './helpers/categories.js';
import { testConfig } from './helpers/config.js';

test('category HTTP routes enforce validation, role/store scope, bilingual content and branch visibility', async t => {
  const f = identityFixture();
  const c = categoryFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const ownerToken = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const tokens = { superAdmin: ownerToken };
  for (const role of ['admin', 'moderator', 'user']) {
    const account = { ...input, email: `${role}@example.com` };
    await f.auth.register('b2c', account, 'en');
    await f.auth.verifyEmail('b2c', account.email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', account.email);
    f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', account.email, account.password)).accessToken;
  }
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    users: f.users, repository: f.repository, userRepository: f.userRepository, email: f.email,
    categoryRepository: c.repository, transaction: c.transaction,
    productRepository: { async hasAssignedCategory() { return false; } },
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, { method = 'GET', token, body, language = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, {
      method, headers: { 'X-Language': language,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, result: await response.json() };
  }
  const staffPath = 'admin/b2c/categories';
  const payload = { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' };
  assert.equal((await request(staffPath, { method: 'POST', body: payload })).status, 401);
  for (const role of ['moderator', 'user']) {
    assert.equal((await request(staffPath, { method: 'POST', token: tokens[role], body: payload })).status, 403);
  }
  assert.equal((await request(staffPath, { method: 'POST', token: tokens.admin,
    body: { name: { en: 'Incomplete' }, slug: 'incomplete' } })).status, 422);
  for (const extra of [{ parentId: { $ne: '' } }, { isActive: 'false' }, { slug: '<script>' }, { position: -1 }]) {
    assert.equal((await request(staffPath, { method: 'POST', token: tokens.admin, body: { ...payload, ...extra } })).status, 422);
  }
  const created = await request(staffPath, { method: 'POST', token: tokens.admin,
    body: { ...payload, store: 'b2b', name: { ...payload.name, fr: 'Ignored' }, image: 'untrusted' } });
  assert.equal(created.status, 201);
  const root = created.result.data;
  assert.equal(root.image, null);
  assert.equal(Object.hasOwn(root.name, 'fr'), false);
  const child = await request(staffPath, { method: 'POST', token: tokens.admin,
    body: { name: { ar: 'قمصان', en: 'Shirts' }, slug: 'shirts', parentId: root.id } });
  assert.equal(child.status, 201);
  assert.equal((await request('b2c/categories', { language: 'ar' })).result.data[0].name, 'ملابس');
  assert.equal((await request('b2c/categories')).result.data[0].children[0].id, child.result.data.id);
  assert.equal((await request('b2b/categories')).status, 404);
  assert.equal((await request('admin/b2b/categories', { token: ownerToken })).status, 404);
  assert.equal((await request(`${staffPath}?limit=101`, { token: ownerToken })).status, 422);
  assert.equal((await request(`${staffPath}/not-id`, { token: ownerToken })).status, 422);
  assert.equal((await request(`${staffPath}?parentId=root&isActive=true`, { token: ownerToken })).result.data.pagination.total, 1);
  const renamed = await request(`${staffPath}/${root.id}`, { method: 'PATCH', token: tokens.admin, body: { name: { ar: 'أزياء' } } });
  assert.equal(renamed.result.data.name.en, 'Clothing');
  assert.equal((await request(`${staffPath}/${root.id}`, { method: 'DELETE', token: tokens.admin })).status, 403);
  const blocked = await request(`${staffPath}/${root.id}`, { method: 'DELETE', token: ownerToken, language: 'ar' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.result.code, 'CATEGORY_HAS_CHILDREN');
  assert.match(blocked.result.message, /[\u0600-\u06ff]/);
  await request(`${staffPath}/${root.id}`, { method: 'PATCH', token: tokens.admin, body: { isActive: false } });
  assert.deepEqual((await request('b2c/categories')).result.data, []);
  assert.equal((await request(`b2c/categories/${child.result.data.id}`)).status, 404);
  assert.equal((await request(`${staffPath}/tree`, { token: ownerToken })).result.data[0].children[0].isActive, true);
  const detached = await request(`${staffPath}/${child.result.data.id}`, { method: 'PATCH', token: tokens.admin, body: { parentId: null } });
  assert.equal(detached.result.data.parentId, null);
  assert.equal((await request(`${staffPath}/${root.id}`, { method: 'DELETE', token: ownerToken })).status, 200);
});
