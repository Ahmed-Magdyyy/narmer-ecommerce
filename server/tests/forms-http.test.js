import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identityFixture } from './helpers/identity.js';
import { formsFixture, textField, choiceField } from './helpers/forms.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';

test('Forms HTTP publishes localized definitions and protects staff edits, fixed fields, versions and store scope', async t => {
  const f = identityFixture();
  const p = formsFixture(f.auth);
  const { input } = await f.verified('b2b');
  await f.auth.provisionSuperAdmin('b2b', input.email);
  const superToken = (await f.auth.login('b2b', input.email, input.password)).accessToken;
  async function account(email, role = 'user', store = 'b2b') {
    await f.auth.register(store, { ...input, email }, 'en');
    await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail(store, email);
    f.accounts.get(user._id).role = role;
    return { user, token: (await f.auth.login(store, email, input.password)).accessToken };
  }
  const admin = await account('forms-admin@example.com', 'admin');
  const moderator = await account('forms-moderator@example.com', 'moderator');
  const customer = await account('forms-customer@example.com');
  const b2c = await account('forms-admin@example.com', 'admin', 'b2c');
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository,
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    definitionRepository: p.repository, transaction: p.transaction,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'b2b/forms', { method = 'GET', token, body, language = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const empty = await request();
  assert.equal(empty.status, 200);
  assert.equal(empty.body.data.items.length, 0);
  assert.deepEqual(empty.body.data.supportedFieldTypes, ['text', 'textarea', 'number', 'select', 'multiselect', 'boolean']);
  assert.equal((await request('b2b/forms/spinning')).status, 404);
  assert.equal((await request('b2b/forms/unknown')).status, 422);
  assert.equal((await request('admin/b2b/forms')).status, 401);
  for (const token of [moderator.token, customer.token]) assert.equal((await request('admin/b2b/forms', { token })).status, 403);
  assert.equal((await request('admin/b2b/forms', { token: b2c.token })).status, 401);
  assert.equal((await request('b2c/forms')).status, 404);
  assert.equal((await request('admin/b2c/forms', { token: b2c.token })).status, 404);
  const list = await request('admin/b2b/forms', { token: admin.token });
  assert.equal(list.body.data.items.length, 5);
  assert.deepEqual(list.body.data.items[0].title, { ar: 'الغزل', en: 'Spinning' });
  const fields = [textField(), choiceField('multiselect')];
  const updated = await request('admin/b2b/forms/spinning', { token: admin.token, method: 'PATCH',
    body: { version: 0, isActive: true, fields, actorId: b2c.user._id, id: 'a'.repeat(24) } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.version, 1);
  assert.equal(p.audits[0].actorId, admin.user._id);
  assert.equal(updated.body.data.id, list.body.data.items[0].id);
  const publicForm = await request('b2b/forms/spinning', { language: 'ar' });
  assert.equal(publicForm.body.data.title, 'الغزل');
  assert.equal(publicForm.body.data.fields[0].label, 'وصف الخامة');
  assert.equal(publicForm.body.data.fixedFields[2].required, false);
  assert.equal((await request('b2b/forms')).body.data.items.length, 1);
  assert.equal((await request('admin/b2b/forms/spinning', { token: admin.token, method: 'PATCH', body: { version: 0, isActive: false } })).body.code, 'FORM_CONFLICT');
  for (const body of [{ version: '1', isActive: false }, { version: 1, fields: null }, { version: 1, title: null },
    { version: 1, fixedFields: [] }, { version: 1, type: 'fabric' }, { version: 1, store: 'b2c' }, { version: 1, supportedFieldTypes: [] }]) {
    assert.equal((await request('admin/b2b/forms/spinning', { token: admin.token, method: 'PATCH', body })).status, 422);
  }
  for (const body of [{ version: 1 }, { version: 1, fields: [{ ...textField(), key: 'phone' }] },
    { version: 1, fields: [{ ...textField(), script: 'run()' }] }]) {
    assert.equal((await request('admin/b2b/forms/spinning', { token: admin.token, method: 'PATCH', body })).body.code, 'INVALID_FORM');
  }
  p.failAudit(true);
  assert.equal((await request('admin/b2b/forms/spinning', { token: superToken, method: 'PATCH', body: { version: 1, isActive: false } })).status, 500);
  assert.equal((await request('b2b/forms/spinning')).status, 200);
  p.failAudit(false);
  assert.equal((await request('admin/b2b/forms/spinning', { token: superToken, method: 'PATCH', body: { version: 1, isActive: false } })).status, 200);
  assert.equal((await request('b2b/forms/spinning')).status, 404);
  assert.equal((await request('admin/b2b/forms/spinning', { token: superToken, method: 'DELETE' })).status, 404);
  assert.equal((await request('admin/b2b/forms', { token: superToken, method: 'POST', body: {} })).status, 404);
  f.accounts.get(admin.user._id).status = 'blocked';
  assert.equal((await request('admin/b2b/forms', { token: admin.token })).status, 401);
});
