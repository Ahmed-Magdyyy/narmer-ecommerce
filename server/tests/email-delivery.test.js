import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { readEnv } from '../src/config/env.js';
import { testEnv } from './helpers/config.js';
import { createEmailSender } from '../src/shared/infrastructure/email/email.js';
import { deliveryFixture } from './helpers/delivery.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { createLeadsService } from '../src/modules/leads/leads.service.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { cartFixture } from './helpers/cart.js';
import { couponsFixture } from './helpers/coupons.js';
import { shippingFixture } from './helpers/shipping.js';
import { ordersFixture, checkoutInput } from './helpers/orders.js';
import { simpleInput } from './helpers/products.js';
import { createOrdersService } from '../src/modules/orders/orders.service.js';

const smtp = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: 'synthetic-password', SMTP_FROM: 'Narmer <sender@example.com>' };
const event = (f, fields = {}) => ({ store: 'b2c', resourceId: '1'.repeat(24), event: 'order.placed', resourceStatus: 'pending',
  eventAt: f.now(), to: 'buyer@example.com', locale: 'en', ...fields });
const source = { name: 'Buyer', total: 55000, canTrack: true, trackingToken: 'x'.repeat(43) };

test('notification templates enable each store explicitly and reject token query exposure, bad placeholders and production HTTP', () => {
  assert.deepEqual(readEnv(testEnv).notificationLinks, { b2c: null, b2b: null });
  const valid = 'https://shop.example/orders/{id}#token={token}';
  assert.equal(readEnv({ ...testEnv, ...smtp, B2C_TRACKING_URL_TEMPLATE: valid }).notificationLinks.b2c, valid);
  for (const template of ['https://shop.example/orders/{id}?token={token}', 'https://shop.example/{id}#{token}{token}',
    'https://shop.example/{id}#{other}', 'https://u:p@shop.example/{id}#{token}', 'javascript:{id}#{token}',
    'https://{id}.example/request#{token}', 'https://shop.example/{id}/{}#{token}']) {
    assert.throws(() => readEnv({ ...testEnv, ...smtp, B2C_TRACKING_URL_TEMPLATE: template }), /B2C_TRACKING_URL_TEMPLATE/);
  }
  assert.throws(() => readEnv({ ...testEnv, B2C_TRACKING_URL_TEMPLATE: valid }), /SMTP/);
  assert.throws(() => readEnv({ ...testEnv, ...smtp, NODE_ENV: 'production', B2C_TRACKING_URL_TEMPLATE: 'http://shop.example/{id}#{token}' }), /HTTPS/);
});

test('SMTP notification sender reuses transport/from, sends one plain-text mailbox and preserves OTP transport', async t => {
  const sent = []; t.mock.method(nodemailer, 'createTransport', () => ({ async sendMail(message) { sent.push(message); } }));
  const email = createEmailSender(readEnv({ ...testEnv, ...smtp }));
  await email.sendNotification({ to: 'buyer@example.com', subject: 'Order update', text: 'Private text' });
  assert.deepEqual(sent[0], { from: smtp.SMTP_FROM, to: { address: 'buyer@example.com' }, subject: 'Order update', text: 'Private text' });
  await email.sendOtp({ to: 'buyer@example.com', store: 'b2b', purpose: 'verify-email', code: '012345', locale: 'ar' });
  assert.ok(sent[1].text.includes('012345')); assert.equal(sent[1].html, undefined);
  await assert.rejects(createEmailSender(readEnv(testEnv)).sendNotification({}), { code: 'EMAIL_UNAVAILABLE' });
});

test('delivery is disabled by store/SMTP, deduplicates committed events and never persists or logs tracking secrets', async () => {
  const f = deliveryFixture(); f.sources.b2c = async () => source;
  f.config.notificationLinks.b2c = null; await f.service.enqueue(event(f), {}); assert.equal(f.rows.size, 0);
  f.config.notificationLinks.b2c = 'https://shop.example/{id}#{token}';
  await f.service.enqueue(event(f, { to: null }), {}); assert.equal(f.rows.size, 0);
  await assert.rejects(f.service.enqueue(event(f)), /transaction/);
  await Promise.all([f.service.enqueue(event(f), {}), f.service.enqueue(event(f), {})]); assert.equal(f.rows.size, 1);
  await Promise.all([f.service.drain(), f.service.drain()]); assert.equal(f.messages.length, 1);
  assert.ok(f.messages[0].text.includes(`#${source.trackingToken}`));
  assert.ok(f.messages[0].text.includes(`Reference: ${event(f).resourceId}`));
  assert.ok(!JSON.stringify([...f.rows.values()]).includes(source.trackingToken)); assert.deepEqual(f.logs, []);
  f.config.smtp = null; assert.deepEqual(await f.service.drain(), { sent: 0, failed: 0, skipped: 0 });
});

test('SMTP failures use five bounded attempts, explicit retry and lease-safe recovery without exposing provider errors', async () => {
  const f = deliveryFixture(); f.sources.b2c = async () => source; f.fail(true); await f.service.enqueue(event(f), {});
  for (let attempt = 1; attempt <= 5; attempt++) { assert.equal((await f.service.drain()).failed, 1); const row = [...f.rows.values()][0];
    assert.equal(row.attempts, attempt); f.advance(60000 * 2 ** (attempt - 1)); }
  const row = [...f.rows.values()][0]; assert.equal(row.state, 'failed'); assert.equal((await f.service.drain()).failed, 0);
  assert.ok(!JSON.stringify(f.logs).includes('synthetic secret')); f.fail(false); await f.service.retryFailed();
  assert.equal((await f.service.drain()).sent, 1); assert.equal(row.state, 'sent');
  await f.service.enqueue(event(f, { resourceId: '2'.repeat(24) }), {});
  const held = await f.repository.claim(['b2c'], f.now(), 'old-lease'); f.advance(120001);
  const reclaimed = await f.repository.claim(['b2c'], f.now(), 'new-lease'); assert.equal(reclaimed._id, held._id);
  assert.equal((await f.repository.finish(held._id, 'old-lease', { state: 'sent' })).matchedCount, 0);
  await f.repository.finish(held._id, 'new-lease', { state: 'pending', nextAttemptAt: f.now() });
  f.rows.get(held._id).attempts = 4; await f.repository.claim(['b2c'], f.now(), 'last-lease'); f.advance(120001);
  await f.service.drain(); assert.equal(f.rows.get(held._id).state, 'failed'); assert.equal(f.rows.get(held._id).lastCode, 'LEASE_EXPIRED');
});

test('emails retain historical event time/language, omit unavailable guest links and never claim bank refund success', async () => {
  const f = deliveryFixture(); f.sources.b2c = async () => ({ ...source, canTrack: false, trackingToken: null });
  await f.service.enqueue(event(f, { event: 'order.status', resourceStatus: 'returned', locale: 'ar' }), {}); await f.service.drain();
  assert.ok(f.messages[0].text.includes('مرتجع')); assert.ok(f.messages[0].text.includes('خارج النظام'));
  assert.ok(!f.messages[0].text.includes('https://')); assert.ok(!f.messages[0].text.includes('null'));
  f.sources.b2b = async () => null; await f.service.enqueue(event(f, { store: 'b2b', event: 'lead.submitted', resourceStatus: 'submitted' }), {});
  assert.equal((await f.service.drain()).skipped, 1); assert.equal([...f.rows.values()].at(-1).lastCode, 'SOURCE_UNAVAILABLE');
});

test('Lead emails share submission/contact transactions, preserve initial locale and do not multiply on replay or SMTP failure', async () => {
  const staff = { store: 'b2b', role: 'superAdmin', userId: 'a'.repeat(24) };
  const auth = { async authorizeStaff(store, identity, roles) { if (!roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); return { _id: identity.userId }; } };
  const f = leadsFixture(auth), d = deliveryFixture(); await f.forms.update('b2b', staff, 'fabric', { version: 0, isActive: true });
  const leads = createLeadsService({ ...f.options, notifications: d.service, transaction: d.transaction(f.transaction) });
  d.sources.b2b = id => leads.getEmailSource(id);
  const draft = await leads.prepare('b2b', null, 'fabric'), input = { draftId: draft.draftId, formVersion: 1, contact: { ...leadContact, email: 'buyer@example.com' } };
  d.failEnqueue(true); await assert.rejects(leads.submit('b2b', null, draft.draftToken, input, 'ar'), /enqueue/);
  assert.equal(f.leadRows.size, 0); assert.equal(d.rows.size, 0); assert.equal(f.draftRows.get(draft.draftId).status, 'open');
  d.failEnqueue(false); const receipt = await leads.submit('b2b', null, draft.draftToken, input, 'ar');
  await leads.submit('b2b', null, draft.draftToken, input, 'en'); assert.equal(d.rows.size, 1);
  d.fail(true); assert.equal((await d.service.drain()).failed, 1); assert.equal(f.leadRows.get(receipt.lead.id).status, 'submitted');
  await leads.contacted('b2b', staff, receipt.lead.id); await leads.contacted('b2b', staff, receipt.lead.id);
  assert.equal(d.rows.size, 2); assert.ok([...d.rows.values()].every(row => row.locale === 'ar'));
  d.fail(false); d.advance(60001); await d.service.drain(); assert.equal(d.messages.length, 2);
  const original = await leads.getEmailSource(receipt.lead.id); assert.equal(original.trackingToken, receipt.trackingToken);
  const rotated = createLeadsService({ ...f.options, trackingSecret: 'changed-key' });
  assert.equal((await rotated.getEmailSource(receipt.lead.id)).canTrack, false);
  assert.equal((await rotated.track('b2b', receipt.lead.id, receipt.trackingToken)).id, receipt.lead.id);
});

test('Order emails are atomic with stock/cart, preserve buyer locale and enqueue once for each real status change', async () => {
  const staff = { store: 'b2c', role: 'superAdmin', userId: 'a'.repeat(24) }, guest = { guestToken: 'a'.repeat(43) };
  const auth = { async authorizeStaff(store, identity, roles) { if (!roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); return { _id: identity.userId, name: 'Test Owner', role: identity.role }; } };
  const p = cartFixture(auth), c = couponsFixture(auth, p), sh = shippingFixture(auth), d = deliveryFixture();
  await sh.shipping.setDefault('b2c', staff, { defaultFee: 5000 });
  const category = await c.categories.create('b2c', staff, { name: { en: 'Clothing', ar: 'ملابس' }, slug: 'clothing' });
  const product = await c.products.create('b2c', staff, simpleInput(category.id)); await c.cart.setItem('b2c', guest, { productId: product.id, quantity: 2 });
  const f = ordersFixture(auth, c, { shipping: sh.shipping });
  const orders = createOrdersService({ auth, cart: c.cart, products: c.products, coupons: c.coupons, shipping: sh.shipping,
    trackingSecret: 'synthetic-order-key', repository: f.repository, transaction: d.transaction(f.transaction), now: f.now, notifications: d.service });
  d.sources.b2c = id => orders.getEmailSource(id);
  const quote = await orders.preview('b2c', guest, checkoutInput());
  d.failEnqueue(true); await assert.rejects(orders.place('b2c', guest, { checkoutId: quote.checkoutId }, 'ar'), /enqueue/);
  assert.equal(f.rows.size, 0); assert.equal(d.rows.size, 0); assert.equal((await c.cart.get('b2c', guest)).itemCount, 2);
  assert.equal((await c.products.getPublic('b2c', product.id)).stock, 10);
  d.failEnqueue(false); const receipt = await orders.place('b2c', guest, { checkoutId: quote.checkoutId }, 'ar');
  await orders.place('b2c', guest, { checkoutId: quote.checkoutId }, 'en'); assert.equal(d.rows.size, 1);
  assert.equal((await orders.getEmailSource(receipt.order.id)).trackingToken, receipt.trackingToken);
  for (let i = 0; i < 2; i++) await orders.changeStatus('b2c', staff, receipt.order.id, { status: 'canceled', expectedStatus: 'pending' }, 'en');
  assert.equal(d.rows.size, 2); assert.ok([...d.rows.values()].every(row => row.locale === 'ar'));
  d.fail(true); await d.service.drain(); assert.equal(f.rows.get(receipt.order.id).status, 'canceled');
  assert.equal((await c.products.getPublic('b2c', product.id)).stock, 10);
  d.fail(false); d.advance(60001); await d.service.drain(); assert.equal(d.messages.length, 2);
  assert.ok(d.messages[1].text.includes('خارج النظام'));
  assert.ok(d.messages.every(message => message.text.includes(`رقم الطلب: ${receipt.order.orderNumber}`)));
  assert.ok(d.messages.every(message => message.text.includes(receipt.order.id)));
  const rotated = createOrdersService({ repository: f.repository, trackingSecret: 'changed-order-key', now: f.now });
  assert.equal((await rotated.getEmailSource(receipt.order.id)).canTrack, false);
  assert.equal((await rotated.track('b2c', receipt.order.id, receipt.trackingToken)).id, receipt.order.id);
});
