import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { identityFixture } from './helpers/identity.js';
import { productFixture, simpleInput } from './helpers/products.js';
import { mediaFixture } from './helpers/media.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('catalog image HTTP enforces store/role, bounded binary bodies and server-owned attachment IDs', async t => {
  const f = identityFixture();
  const p = productFixture(f.auth);
  const m = mediaFixture();
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const token = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  const identity = await f.auth.authenticate('b2c', token);
  const root = await p.categories.create('b2c', identity, { slug: 'clothing', name: { ar: 'ملابس', en: 'Clothing' } });
  const product = await p.products.create('b2c', identity, simpleInput(root.id));
  const tokens = {};
  for (const role of ['admin', 'moderator', 'user']) {
    const account = { ...input, email: `media-${role}@example.com` };
    await f.auth.register('b2c', account, 'en');
    await f.auth.verifyEmail('b2c', account.email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail('b2c', account.email);
    f.accounts.get(user._id).role = role;
    tokens[role] = (await f.auth.login('b2c', account.email, account.password)).accessToken;
  }
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    categoryRepository: p.categoryRepository, productRepository: p.repository, transaction: p.transaction,
    imageRepository: m.repository, storage: m.storage,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const buffer = await sharp({ create: { width: 10, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
  async function request(path, { method = 'POST', accessToken = token, body = buffer, type = 'image/png' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, {
      method, headers: { 'Content-Type': type, 'X-Language': 'ar', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(method === 'GET' ? {} : { body }),
    });
    return { status: response.status, result: await response.json() };
  }
  const uploadPath = `admin/b2c/media/product/${product.id}`;
  assert.equal((await request(uploadPath, { accessToken: null })).status, 401);
  for (const role of ['moderator', 'user']) assert.equal((await request(uploadPath, { accessToken: tokens[role] })).status, 403);
  assert.equal((await request('admin/b2b/media/product/' + product.id)).status, 401);
  assert.equal((await request('b2c/media/product/' + product.id)).status, 404);
  assert.equal((await request('admin/b2c/media/product/invalid')).status, 422);
  assert.equal((await request(`admin/b2c/media/product/${'f'.repeat(24)}`)).status, 404);
  assert.equal((await request(uploadPath, { type: 'image/svg+xml', body: '<svg />' })).status, 415);
  assert.equal((await request(uploadPath, { type: 'image/jpeg' })).status, 422);
  assert.equal((await request(uploadPath, { body: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(m.uploads.length, 0);
  const uploaded = await request(uploadPath, { accessToken: tokens.admin });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.result.data.width, 10);
  assert.equal(uploaded.result.data.objectKey, undefined);
  assert.match(uploaded.result.data.url, /^https:\/\/catalog.example\/narmer\/b2c\/catalog\/product\//);
  const image = uploaded.result.data;
  const patched = await request(`admin/b2c/products/${product.id}`, { method: 'PATCH', accessToken: tokens.admin, type: 'application/json',
    body: JSON.stringify({ version: 0, imageIds: [image.id], images: [{ url: 'https://attacker.example/file.svg' }] }) });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.result.data.images, [image]);
  assert.equal((await request(`b2c/products/${product.id}`, { method: 'GET' })).result.data.images[0].id, image.id);
  assert.equal((await request(`admin/b2c/products/${product.id}`, { method: 'PATCH', type: 'application/json',
    body: JSON.stringify({ version: 1, imageIds: null }) })).status, 422);
  const categoryImage = await request(`admin/b2c/media/category/${root.id}`);
  const categoryPatched = await request(`admin/b2c/categories/${root.id}`, { method: 'PATCH', type: 'application/json',
    body: JSON.stringify({ imageId: categoryImage.result.data.id }) });
  assert.equal(categoryPatched.status, 200);
  assert.equal(categoryPatched.result.data.image.id, categoryImage.result.data.id);
});
