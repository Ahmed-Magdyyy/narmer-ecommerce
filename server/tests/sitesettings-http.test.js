import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { sitesettingsFixture, settingsInput } from './helpers/sitesettings.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('site-settings HTTP covers both stores, all six operations, strict updates and localized public projections', async t => {
  const auth = identityFixture(), f = sitesettingsFixture(auth.auth), tokens = {};
  for (const store of ['b2c', 'b2b']) {
    const { input } = await auth.verified(store);
    await auth.auth.provisionSuperAdmin(store, input.email);
    tokens[store] = (await auth.auth.login(store, input.email, input.password)).accessToken;
    for (const role of ['admin', 'moderator', 'user']) {
      const account = { ...input, email: `settings-${role}@example.test` };
      await auth.auth.register(store, account); await auth.auth.verifyEmail(store, account.email, auth.emails.at(-1).code);
      const user = await auth.users.findAccountByEmail(store, account.email); auth.accounts.get(user._id).role = role;
      tokens[`${store}-${role}`] = (await auth.auth.login(store, account.email, input.password)).accessToken;
    }
  }
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: auth.users, email: auth.email, repository: auth.repository, userRepository: auth.userRepository,
    siteRepository: f.repository, transaction: f.transaction,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, { method = 'GET', body, token, language = 'en' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, ...(await response.json()) };
  };
  for (const store of ['b2c', 'b2b']) {
    const path = `admin/${store}/site-settings`, token = tokens[store];
    const initial = await request(`${store}/site-settings`);
    assert.equal(initial.status, 200); assert.equal(initial.data.store, store);
    assert.equal(initial.data.seo.title, 'Narmer'); assert.equal(initial.data.updatedAt, null);
    assert.equal(Object.hasOwn(initial.data, 'version'), false);
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { token: tokens[store === 'b2c' ? 'b2b' : 'b2c'] })).status, 401);
    for (const role of ['moderator', 'user']) {
      assert.equal((await request(path, { token: tokens[`${store}-${role}`] })).status, 403);
      assert.equal((await request(path, { method: 'PATCH', token: tokens[`${store}-${role}`], body: settingsInput })).status, 403);
    }
    const staff = await request(path, { token });
    assert.equal(staff.data.version, 0); assert.deepEqual(staff.data.address, { en: '', ar: '' });
    for (const body of [{}, { version: 0 }, { version: '0', phone: null }, { version: 0, unknown: 1 },
      { version: 0, seo: { unknown: 'x' } }, { version: 0, social: { telegramUrl: 'https://t.me/test' } },
      { version: 0, address: {} }, { version: 0, seo: null }, { version: 0, email: 7 },
      { version: 0, email: '' }, { version: 0, phone: '' }, { version: 0, mapUrl: 'javascript:alert(1)' },
      { version: 0, social: { facebookUrl: 'https://www.facebook.com.attacker.test' } },
      { version: 0, seo: { title: { en: ' ' } } }, { version: 0, address: { en: 'x', fr: 'y' } }]) {
      assert.equal((await request(path, { method: 'PATCH', token, body })).status, 422, JSON.stringify(body));
    }
    const saved = await request(path, { method: 'PATCH', token: tokens[`${store}-admin`], body: settingsInput });
    assert.equal(saved.status, 200); assert.equal(saved.data.version, 1);
    assert.equal(saved.data.phone, '+201001234567'); assert.equal(saved.data.email, 'info@example.test');
    assert.equal(typeof saved.data.updatedAt, 'string'); assert.equal(saved.data.seo.title.ar, settingsInput.seo.title.ar);
    assert.deepEqual((await request(path, { token })).data, saved.data);
    assert.equal((await request(path, { method: 'PATCH', token, body: settingsInput })).code, 'SITE_SETTINGS_CONFLICT');
    const publicAr = await request(`${store}/site-settings`, { language: 'ar' });
    assert.equal(publicAr.data.address, settingsInput.address.ar); assert.equal(publicAr.data.seo.title, settingsInput.seo.title.ar);
    assert.deepEqual(Object.keys(publicAr.data).sort(), ['store', 'phone', 'email', 'address', 'mapUrl', 'social', 'seo', 'updatedAt'].sort());
    const cleared = await request(path, { method: 'PATCH', token, body: { version: 1, phone: null, email: null,
      mapUrl: '', social: { instagramUrl: null, whatsappUrl: '' }, address: { ar: '' }, seo: { description: { ar: '' }, keywords: '' } } });
    assert.equal(cleared.status, 200); assert.equal(cleared.data.version, 2);
    assert.equal(cleared.data.email, null); assert.equal(cleared.data.phone, null); assert.equal(cleared.data.mapUrl, null);
    assert.equal(cleared.data.social.instagramUrl, null); assert.equal(cleared.data.social.whatsappUrl, null);
    assert.equal(cleared.data.social.facebookUrl, settingsInput.social.facebookUrl);
    const fallback = await request(`${store}/site-settings`, { language: 'ar' });
    assert.equal(fallback.data.address, settingsInput.address.en); assert.equal(fallback.data.seo.description, settingsInput.seo.description.en);
    const remainingLinks = await request(path, { method: 'PATCH', token, body: { version: 2,
      social: { tiktokUrl: null, facebookUrl: null } } });
    assert.equal(remainingLinks.status, 200); assert.equal(remainingLinks.data.version, 3);
    assert.equal(remainingLinks.data.social.tiktokUrl, null); assert.equal(remainingLinks.data.social.facebookUrl, null);
  }
  const updated = await request('admin/b2c/site-settings', { method: 'PATCH', token: tokens.b2c,
    body: { version: 3, seo: { title: { en: 'B2C only' } } } });
  assert.equal(updated.data.version, 4);
  assert.equal((await request('b2b/site-settings')).data.seo.title, settingsInput.seo.title.en);
  assert.equal(f.rows.size, 2); assert.equal(f.audits.length, 7);
});
