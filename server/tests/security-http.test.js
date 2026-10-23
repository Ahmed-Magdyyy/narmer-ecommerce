import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Router } from 'express';
import { createApp } from '../src/app/app.js';
import { createApiRouter } from '../src/app/routes.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { createAuthenticate } from '../src/modules/auth/auth.middleware.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { testConfig } from './helpers/config.js';
import { identityFixture } from './helpers/identity.js';

async function serve(t, apiRouter, trustProxy = 0) {
  const server = createApp({ ...testConfig, trustProxy }, { apiRouter, isReady: () => true,
    logger: { info() {}, error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async (path, { token, ip, method = 'GET', body, raw } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { Origin: 'https://shop.example', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
}

function protectedRouter() {
  const authenticate = createAuthenticate({ async authenticate(store, token) {
    if (!['one-a', 'one-b', 'two'].includes(token)) throw new AppError(401, 'UNAUTHORIZED');
    return { store, userId: (token === 'two' ? '2' : '1').repeat(24), role: 'user', sessionId: token };
  } });
  const router = () => { const r = Router(); r.use(authenticate); r.use((req, res) => res.json({ ok: true })); return r; };
  return createApiRouter({ b2c: router(), b2b: router(), adminB2c: router(), adminB2b: router() });
}

test('API IP quota covers both stores before JSON parsing and ignores spoofed proxy headers by default', async t => {
  const publicRouter = Router(); publicRouter.use((req, res) => res.json({ ok: true }));
  const request = await serve(t, createApiRouter({ b2c: publicRouter, b2b: publicRouter }));
  for (let i = 0; i < 240; i++) assert.equal((await request(`/api/v1/${i % 2 ? 'b2b' : 'b2c'}/public`, { ip: `192.0.2.${i % 200 + 1}` })).status, 200);
  const denied = await request('/api/v1/b2c/public', { method: 'POST', raw: '{broken', ip: '198.51.100.1' });
  assert.equal(denied.status, 429); assert.equal(denied.data.code, 'TOO_MANY_REQUESTS');
  assert.equal(denied.headers.get('cache-control'), 'no-store'); assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.match(denied.headers.get('access-control-expose-headers'), /Retry-After/);
  assert.equal(denied.headers.get('access-control-allow-origin'), 'https://shop.example');
  assert.equal((await request('/health/live')).status, 200);
});

test('authenticated quota follows the account across tokens/IPs/routes while isolating other accounts and stores', async t => {
  const request = await serve(t, protectedRouter(), 1);
  for (let i = 0; i < 120; i++) assert.equal((await request(`/api/v1/b2c/${i % 2 ? 'users/me' : 'orders'}?userId=forged`,
    { token: i % 2 ? 'one-a' : 'one-b', ip: `192.0.2.${i % 200 + 1}` })).status, 200);
  assert.equal((await request('/api/v1/b2c/orders', { token: 'one-b', ip: '198.51.100.1' })).status, 429);
  assert.equal((await request('/api/v1/b2c/orders', { token: 'two', ip: '198.51.100.1' })).status, 200);
  assert.equal((await request('/api/v1/b2b/leads', { token: 'one-a', ip: '198.51.100.1' })).status, 200);
  assert.equal((await request('/api/v1/b2c/orders', { token: 'forged', ip: '198.51.100.2' })).status, 401);
});

test('sensitive account quotas cannot be bypassed through case/trailing slash or changing IP', async t => {
  const request = await serve(t, protectedRouter(), 1); const objectId = 'a'.repeat(24);
  for (const [path, count, store] of [
    [`/api/v1/admin/b2c/media/product/${objectId}`, 60, 'b2c'],
    [`/api/v1/b2c/cart/checkout/${objectId}/proof`, 20, 'b2c'],
    [`/api/v1/b2b/leads/drafts/${objectId}/images`, 30, 'b2b'],
  ]) {
    for (let i = 0; i < count; i++) assert.equal((await request(i % 2 ? path.toUpperCase() + '/' : path,
      { token: i % 2 ? 'one-a' : 'one-b', ip: `192.0.2.${i + 1}` })).status, 200);
    assert.equal((await request(path, { token: 'one-a', ip: '198.51.100.1' })).status, 429, store + ' quota');
    assert.equal((await request(path, { token: 'two', ip: '198.51.100.2' })).status, 200);
    if (path.includes('/media/')) {
      assert.equal((await request(`/API/V1/ADMIN/B2C/SIZE-CHARTS/${objectId}/IMAGES/EN/`,
        { token: 'one-b', ip: '198.51.100.3' })).status, 429);
      assert.equal((await request(`/api/v1/admin/b2c/size-charts/${objectId}/images/ar`,
        { token: 'two', ip: '198.51.100.4' })).status, 200);
      assert.equal((await request('/API/V1/ADMIN/B2C/HOMEPAGE/MEDIA/HERO-LEFT/MOBILE/',
        { token: 'one-b', ip: '198.51.100.5' })).status, 429);
      assert.equal((await request('/api/v1/admin/b2c/homepage/media/hero-left/desktop',
        { token: 'two', ip: '198.51.100.6' })).status, 200);
    }
  }
});

test('Cart and Wishlist account counters retain their fifteen-minute history across minute-window resets', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const request = await serve(t, protectedRouter(), 1);
  for (const section of ['cart', 'wishlist']) {
    t.mock.timers.tick(60001);
    for (let i = 0; i < 150; i++) {
      if (i === 100) t.mock.timers.tick(60001);
      assert.equal((await request(`/api/v1/b2c/${section}`, { token: 'one-a', ip: `192.0.2.${i % 200 + 1}` })).status, 200);
    }
    assert.equal((await request(`/api/v1/b2c/${section}`, { token: 'one-b', ip: '198.51.100.1' })).status, 429);
  }
});

test('normalized login identity limits distributed failures, preserves other stores, and does not count successful logins', async t => {
  const f = identityFixture(), { input } = await f.verified('b2c');
  const request = await serve(t, createBusinessRouter(testConfig, { users: f.users, email: f.email,
    repository: f.repository, userRepository: f.userRepository, transaction: f.transaction }), 1);
  for (let i = 0; i < 12; i++) assert.equal((await request('/api/v1/b2c/auth/login', { method: 'POST', ip: `192.0.2.${i + 1}`, body: input })).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/v1/b2c/auth/login', { method: 'POST', ip: `192.0.2.${i + 20}`,
    body: { email: i % 2 ? input.email.toUpperCase() : ' ' + input.email + ' ', password: 'wrong-password' } })).status, 401);
  const blocked = await request('/api/v1/b2c/auth/login', { method: 'POST', ip: '198.51.100.1', body: input });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/api/v1/b2b/auth/login', { method: 'POST', ip: '198.51.100.2', body: input })).status, 401);
});
