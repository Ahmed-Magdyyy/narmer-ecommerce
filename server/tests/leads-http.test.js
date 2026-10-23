import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { identityFixture } from './helpers/identity.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { textField } from './helpers/forms.js';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';
import { emptyNotificationsRepository } from './helpers/notifications.js';

test('Leads HTTP protects guest credentials, customer ownership, staff-only photos and contact transitions', async t => {
  const f = identityFixture(), p = leadsFixture(f.auth), { input } = await f.verified('b2b');
  await f.auth.provisionSuperAdmin('b2b', input.email);
  const staffToken = (await f.auth.login('b2b', input.email, input.password)).accessToken;
  const staffIdentity = await f.auth.authenticate('b2b', staffToken);
  async function account(email, role = 'user', store = 'b2b') {
    await f.auth.register(store, { ...input, email }, 'en');
    await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
    const user = await f.users.findAccountByEmail(store, email); f.accounts.get(user._id).role = role;
    return (await f.auth.login(store, email, input.password)).accessToken;
  }
  const moderator = await account('lead-moderator@example.com', 'moderator');
  const customer = await account('lead-customer@example.com'), other = await account('lead-other@example.com');
  const b2c = await account('lead-customer@example.com', 'user', 'b2c');
  await p.forms.update('b2b', staffIdentity, 'fabric', { version: 0, isActive: true, fields: [
    textField(), { ...textField('owns-material'), type: 'boolean', required: true },
  ] });
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    definitionRepository: p.formRepository, offerRepository: p.wholesaleRepository,
    submissionRepository: p.repository,
    staffNotificationRepository: emptyNotificationsRepository,
    transaction: p.transaction, leadStorage: p.storage,
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path = 'b2b/leads', { method = 'GET', token, draftToken, trackingToken, body, raw, type = 'image/png', language = 'en' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`, { method,
      headers: { 'X-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(draftToken ? { 'X-Lead-Draft-Token': draftToken } : {}), ...(trackingToken ? { 'X-Lead-Token': trackingToken } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : raw ? { 'Content-Type': type } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : raw ? { body: raw } : {}) });
    return { status: response.status, headers: response.headers,
      body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  assert.equal((await request('b2c/leads/drafts', { method: 'POST', body: { formType: 'fabric' } })).status, 404);
  for (const token of [staffToken, moderator]) assert.equal((await request('b2b/leads/drafts', { method: 'POST', token, body: { formType: 'fabric' } })).status, 403);
  assert.equal((await request('b2b/leads/drafts', { method: 'POST', token: b2c, body: { formType: 'fabric' } })).status, 401);
  const prepared = await request('b2b/leads/drafts', { method: 'POST', body: { formType: 'fabric' } });
  assert.equal(prepared.status, 201); assert.equal(prepared.headers.get('cache-control'), 'no-store');
  const draft = prepared.body.data, draftPath = `b2b/leads/drafts/${draft.draftId}`;
  assert.equal((await request(draftPath)).status, 401);
  assert.equal((await request(draftPath, { draftToken: 'x'.repeat(43) })).status, 409);
  assert.deepEqual((await request(draftPath, { draftToken: draft.draftToken })).body.data.images, []);
  const png = await sharp({ create: { width: 4, height: 5, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await request(`${draftPath}/images`, { method: 'POST', draftToken: draft.draftToken, raw: png, type: 'text/plain' })).status, 415);
  const uploaded = await request(`${draftPath}/images`, { method: 'POST', draftToken: draft.draftToken, raw: png });
  assert.equal(uploaded.status, 201); const image = uploaded.body.data;
  assert.deepEqual(Object.keys(image).sort(), ['height', 'id', 'width']);
  assert.equal((await request(draftPath, { draftToken: draft.draftToken })).body.data.images[0].id, image.id);
  const submission = { draftId: draft.draftId, formVersion: 1, contact: { ...leadContact, email: ' Buyer@EXAMPLE.COM ' },
    answers: { 'owns-material': false }, imageIds: [image.id] };
  assert.equal((await request(undefined, { method: 'POST', draftToken: draft.draftToken, body: { ...submission, userId: 'a'.repeat(24) } })).status, 422);
  assert.equal((await request(undefined, { method: 'POST', draftToken: draft.draftToken, body: { ...submission, contact: { ...leadContact, email: 'invalid' } } })).status, 422);
  const placed = await request(undefined, { method: 'POST', draftToken: draft.draftToken, body: submission });
  assert.equal(placed.status, 201); const receipt = placed.body.data, lead = receipt.lead;
  assert.equal(lead.contact.email, 'buyer@example.com'); assert.equal(lead.answers['owns-material'], false);
  assert.equal(lead.imageCount, 1); assert.equal(lead.imageIds, undefined); assert.equal(lead.userId, undefined);
  const replay = await request(undefined, { method: 'POST', draftToken: draft.draftToken, body: submission });
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.data, receipt);
  assert.equal((await request(undefined, { method: 'POST', draftToken: draft.draftToken, body: { ...submission, imageIds: [] } })).body.code, 'LEAD_REQUEST_CONFLICT');
  assert.equal((await request(`b2b/leads/tracking/${lead.id}`)).status, 404);
  const tracked = await request(`b2b/leads/tracking/${lead.id}`, { trackingToken: receipt.trackingToken, language: 'ar' });
  assert.equal(tracked.status, 200); assert.equal(tracked.body.data.form.title, 'الأقمشة');
  const staffPath = `admin/b2b/leads/${lead.id}`;
  assert.equal((await request(staffPath)).status, 401);
  assert.equal((await request(staffPath, { token: customer })).status, 403);
  const staffView = await request(staffPath, { token: moderator });
  assert.equal(staffView.body.data.imageIds[0], image.id); assert.equal(staffView.body.data.userId, null);
  assert.ok(!JSON.stringify(staffView.body).includes('trackingHash'));
  const imagePath = `${staffPath}/images/${image.id}`;
  assert.equal((await request(imagePath, { token: customer })).status, 403);
  const bytes = await request(imagePath, { token: moderator });
  assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('cache-control'), 'no-store');
  assert.equal((await sharp(bytes.body).metadata()).format, 'webp');
  const contacted = await request(`${staffPath}/contacted`, { method: 'PATCH', token: moderator });
  assert.equal(contacted.status, 200); assert.equal(contacted.body.data.status, 'contacted');
  assert.deepEqual((await request(`${staffPath}/contacted`, { method: 'PATCH', token: staffToken })).body.data, contacted.body.data);
  assert.equal((await request(staffPath, { method: 'DELETE', token: staffToken })).status, 404);
  assert.equal((await request('admin/b2b/forms/fabric', { method: 'PATCH', token: moderator, body: { version: 1, isActive: false } })).status, 403);
  const accountDraft = (await request('b2b/leads/drafts', { method: 'POST', token: customer, body: { formType: 'fabric' } })).body.data;
  const accountReceipt = (await request(undefined, { method: 'POST', token: customer, draftToken: accountDraft.draftToken,
    body: { ...submission, draftId: accountDraft.draftId, imageIds: [] } })).body.data;
  assert.equal(accountReceipt.trackingToken, null);
  assert.equal((await request(undefined, { token: customer })).body.data.pagination.total, 1);
  assert.equal((await request(`b2b/leads/${accountReceipt.lead.id}`, { token: other })).status, 404);
  assert.equal((await request(`b2b/leads/${lead.id}`, { token: customer })).status, 404);
  assert.equal((await request('admin/b2b/leads?status=contacted', { token: moderator })).body.data.pagination.total, 1);
  assert.equal((await request('admin/b2b/leads?status=pending', { token: moderator })).status, 422);
});
