import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { reportOrder, reportRange, emptyReportRepository } from './helpers/reports.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('report HTTP covers three routes, role/store boundaries, complete DTOs, strict queries, empty periods and shared account throttling', async t => {
  const f = identityFixture(), tokens = {}, order = reportOrder(); let empty = false, failureMode = null;
  const { input } = await f.verified('b2c'); await f.auth.provisionSuperAdmin('b2c', input.email);
  tokens.superAdmin = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  for (const [store, role] of [['b2c', 'admin'], ['b2c', 'moderator'], ['b2c', 'user'], ['b2b', 'admin']]) {
    const account = { ...input, email: `${store}-${role}@example.test` };
    await f.auth.register(store, account); await f.auth.verifyEmail(store, account.email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail(store, account.email); f.accounts.get(user._id).role = role;
    tokens[`${store}-${role}`] = (await f.auth.login(store, account.email, input.password)).accessToken;
  }
  const ranking = { productId: 'a'.repeat(24), name: order.items[0].name, quantity: 2, orderCount: 1, merchandiseAmount: 9000 };
  const reportRepository = { async aggregate(pipeline) {
    if (failureMode === 'timeout') throw Object.assign(new Error('synthetic aggregation timeout'), { code: 50 });
    if (failureMode === 'unsafe') return [{ total: Number.MAX_SAFE_INTEGER + 1 }];
    const [result] = await emptyReportRepository.aggregate(pipeline); if (empty) return [result];
    if (Object.hasOwn(result, 'metrics')) Object.assign(result, {
      metrics: [{ ordersPlaced: 1, unitsPlaced: 2, placedOrderAmount: 14000, pendingOrders: 0 }], topProducts: [ranking, { ...ranking, productId: 'd'.repeat(24) }], recentOrders: [order],
      trend: [{ _id: '2026-01-10', ordersPlaced: 1, unitsPlaced: 2, placedOrderAmount: 14000 }],
    });
    else if (Object.hasOwn(result, 'orderAmounts')) Object.assign(result, {
      orderAmounts: [{ subtotal: 10000, couponDiscountAmount: 1000, shippingFee: 5000, total: 14000 }], byStatus: [{ _id: 'delivered', count: 1, orderAmount: 14000 }],
      byPaymentMethod: [{ _id: 'cod', orderCount: 1, orderAmount: 14000 }], cod: [{ amount: 14000 }], placedTrend: [{ _id: '2026-01-10', placedOrderAmount: 14000 }],
      codTrend: [{ _id: '2026-01-10', codCollectedAmount: 14000 }],
    });
    else Object.assign(result, { items: [ranking, { ...ranking, productId: 'd'.repeat(24) }], total: [{ count: 2 }], categories: [{ _id: 'b'.repeat(24), name: order.items[0].category.name, quantity: 2, merchandiseAmount: 9000 },
      { _id: null, name: null, quantity: 0, merchandiseAmount: 0 }] });
    return [result];
  } };
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository, reportRepository,
    productRepository: { async findByIds() { return [{ _id: 'a'.repeat(24), slug: 'current-shirt', images: [{ id: 'e'.repeat(24), url: 'https://cdn.example.test/narmer/b2c/products/test.webp', width: 600, height: 800 }] }]; } },
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (endpoint, query = reportRange, token = tokens.superAdmin, store = 'b2c', locale = 'en') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/${store}/reports/${endpoint}?${new URLSearchParams(query)}`,
      { headers: { 'X-Language': locale, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return { status: response.status, headers: response.headers, ...(await response.json()) };
  };
  for (const endpoint of ['overview', 'finance', 'sales-performance']) {
    const result = await request(endpoint); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.data.meta.definitionsVersion, 'v1'); assert.equal(result.data.meta.timezone, 'Africa/Cairo');
    assert.equal((await request(endpoint, reportRange, tokens['b2c-admin'])).status, 200);
    for (const role of ['moderator', 'user']) assert.equal((await request(endpoint, reportRange, tokens[`b2c-${role}`])).status, 403);
    assert.equal((await request(endpoint, reportRange, '')).status, 401);
    assert.equal((await request(endpoint, reportRange, tokens['b2b-admin'])).status, 401);
  }
  assert.equal((await request('overview', reportRange, tokens.superAdmin, 'b2c', 'ar')).data.topProducts[0].name, 'قميص قديم');
  assert.equal((await request('sales-performance', { ...reportRange, interval: 'week', rankBy: 'merchandiseAmount', page: 1, limit: 10 })).status, 200);
  for (const query of [{}, { ...reportRange, from: '2026-01-01' }, { ...reportRange, from: '2026-02-30T00:00:00Z' },
    { ...reportRange, from: reportRange.to }, { ...reportRange, timezone: 'UTC' }, { ...reportRange, interval: 'year' },
    { ...reportRange, from: '1999-01-01T00:00:00Z' }, { ...reportRange, page: 1 }, { ...reportRange, unknown: 'x' }])
    assert.equal((await request('overview', query)).status, 422);
  assert.equal((await request('sales-performance', { ...reportRange, limit: 101 })).status, 422);
  assert.equal((await request('sales-performance', { ...reportRange, rankBy: 'profit' })).status, 422);
  assert.equal((await request('finance', {})).status, 422);
  assert.equal((await request('overview', reportRange, tokens['b2b-admin'], 'b2b')).status, 404);
  empty = true;
  for (const endpoint of ['overview', 'finance', 'sales-performance']) assert.equal((await request(endpoint)).status, 200);
  for (const [mode, code] of [['timeout', 'REPORT_BUSY'], ['unsafe', 'REPORT_TOTAL_UNAVAILABLE']]) {
    failureMode = mode;
    for (const endpoint of ['overview', 'finance', 'sales-performance']) {
      const response = await request(endpoint); assert.equal(response.status, 503); assert.equal(response.code, code);
    }
  }
  failureMode = null;
  let limited;
  for (let i = 0; i < 30; i++) limited = await request('finance', reportRange, tokens['b2c-admin']);
  assert.equal(limited.status, 429); assert.equal(limited.code, 'TOO_MANY_REQUESTS'); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
