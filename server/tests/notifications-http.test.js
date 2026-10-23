import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { notificationsFixture } from './helpers/notifications.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('staff notification HTTP shares store feeds with personal reads, guards roles, and captures real guest Lead arrivals', async t => {
  const f = identityFixture(), p = leadsFixture(f.auth), n = notificationsFixture(f.auth), { input } = await f.verified('b2b');
  await f.auth.provisionSuperAdmin('b2b', input.email);
  const superToken = (await f.auth.login('b2b', input.email, input.password)).accessToken, superIdentity = await f.auth.authenticate('b2b', superToken);
  async function account(email, role, store = 'b2b') {
    await f.auth.register(store, { ...input, email }, 'en'); await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail(store, email); f.accounts.get(user._id).role = role;
    return { userId: user._id, token: (await f.auth.login(store, email, input.password)).accessToken };
  }
  const admin = await account('inbox-admin@example.com', 'admin'), mod = await account('inbox-mod@example.com', 'moderator');
  const customer = await account('inbox-customer@example.com', 'user'), b2c = await account('inbox-admin@example.com', 'admin', 'b2c');
  await p.forms.update('b2b', superIdentity, 'fabric', { version: 0, isActive: true });
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { users: f.users, email: f.email, repository: f.repository,
    userRepository: f.userRepository, definitionRepository: p.formRepository, offerRepository: p.wholesaleRepository,
    submissionRepository: p.repository, staffNotificationRepository: n.repository, transaction: n.transaction(p.transaction), leadStorage: p.storage }),
    isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'admin/b2b/notifications', { method = 'GET', token, body, draftToken, locale = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': locale, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(draftToken ? { 'X-Lead-Draft-Token': draftToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  assert.equal((await request()).status, 401); assert.equal((await request(undefined, { token: customer.token })).status, 403);
  assert.equal((await request(undefined, { token: b2c.token })).status, 401);
  assert.equal((await request('b2b/notifications', { token: customer.token })).status, 404);
  const empty = await request(undefined, { token: superToken }); assert.equal(empty.status, 200); assert.equal(empty.cache, 'no-store');
  assert.deepEqual(empty.body.data, { items: [], unreadCount: 0, pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  const draft = (await request('b2b/leads/drafts', { method: 'POST', body: { formType: 'fabric' } })).body.data;
  const submitted = await request('b2b/leads', { method: 'POST', draftToken: draft.draftToken,
    body: { draftId: draft.draftId, formVersion: 1, contact: leadContact } }); assert.equal(submitted.status, 201);
  const list = await request(undefined, { token: mod.token, locale: 'ar' }); const item = list.body.data.items[0];
  assert.equal(item.title, 'طلب خدمة جديد'); assert.equal(list.body.data.unreadCount, 1);
  assert.deepEqual(Object.keys(item).sort(), ['id', 'isRead', 'occurredAt', 'readAt', 'resource', 'title', 'type']);
  assert.equal(item.resource.id, submitted.body.data.lead.id); assert.equal(item.resource.type, 'lead');
  assert.equal((await request('admin/b2b/notifications/unread-count', { token: mod.token })).body.data.unreadCount, 1);
  const readPath = `admin/b2b/notifications/${item.id.toUpperCase()}/read`;
  const read = await request(readPath, { method: 'PATCH', token: mod.token, body: { userId: admin.userId, store: 'b2c', status: 'contacted' } });
  assert.equal(read.status, 200); assert.equal(read.body.data.isRead, true);
  assert.deepEqual((await request(readPath, { method: 'PATCH', token: mod.token })).body.data, read.body.data);
  assert.equal((await request('admin/b2b/notifications/unread-count', { token: mod.token })).body.data.unreadCount, 0);
  assert.equal((await request('admin/b2b/notifications/unread-count', { token: admin.token })).body.data.unreadCount, 1);
  assert.equal((await request('admin/b2b/notifications?unreadOnly=true', { token: mod.token })).body.data.pagination.total, 0);
  assert.equal((await request('admin/b2b/notifications?unreadOnly=true&userId=' + mod.userId, { token: admin.token })).body.data.items.length, 1);
  assert.equal((await request(`admin/b2b/leads/${item.resource.id}`, { token: mod.token })).body.data.status, 'submitted');
  const otherStore = await request('admin/b2c/notifications', { token: b2c.token }); assert.equal(otherStore.body.data.unreadCount, 0);
  assert.equal((await request(`admin/b2c/notifications/${item.id}/read`, { method: 'PATCH', token: b2c.token })).status, 404);
  for (const query of ['unreadOnly=1', 'unreadOnly=True', 'unreadOnly=true&unreadOnly=false', 'page=0', 'limit=101']) {
    assert.equal((await request('admin/b2b/notifications?' + query, { token: admin.token })).status, 422);
  }
  assert.equal((await request('admin/b2b/notifications/bad/read', { method: 'PATCH', token: admin.token })).status, 422);
  assert.equal((await request(`admin/b2b/notifications/${'f'.repeat(24)}/read`, { method: 'PATCH', token: admin.token })).body.code, 'NOTIFICATION_NOT_FOUND');
  for (const method of ['POST', 'DELETE']) assert.equal((await request(undefined, { token: superToken, method })).status, 404);
  f.accounts.get(admin.userId).status = 'blocked'; assert.equal((await request(undefined, { token: admin.token })).status, 401);
});
