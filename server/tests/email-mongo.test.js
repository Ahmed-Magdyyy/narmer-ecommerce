import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { EmailDelivery } from '../src/shared/infrastructure/email/delivery.model.js';
import { emailDeliveryRepository as repository } from '../src/shared/infrastructure/email/delivery.repository.js';
import { createEmailDelivery } from '../src/shared/infrastructure/email/delivery.js';
import { runTransaction } from '../src/shared/utils/transaction.js';
import { formsRepository } from '../src/modules/forms/forms.repository.js';
import { createFormsService } from '../src/modules/forms/forms.service.js';
import { leadsRepository } from '../src/modules/leads/leads.repository.js';
import { Lead } from '../src/modules/leads/leads.model.js';
import { createLeadsService } from '../src/modules/leads/leads.service.js';
import { ordersRepository } from '../src/modules/orders/orders.repository.js';
import { Order } from '../src/modules/orders/orders.model.js';
import { createOrdersService } from '../src/modules/orders/orders.service.js';
import { checkoutInput } from './helpers/orders.js';
import { leadContact } from './helpers/leads.js';
import { Notification, NotificationRead } from '../src/modules/notifications/notifications.model.js';
import { notificationsRepository } from '../src/modules/notifications/notifications.repository.js';
import { createNotificationsService } from '../src/modules/notifications/notifications.service.js';

const uri = process.env.NARMER_TEST_MONGODB_URI;
test('real MongoDB staff inbox and email queue share Order/Lead transactions, personal reads and delivery leases', { skip: !uri }, async t => {
  const databaseName = `narmer_test_${randomBytes(12).toString('hex')}`;
  await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
  t.after(async () => { try { assert.equal(mongoose.connection.name, databaseName); assert.match(databaseName, /^narmer_test_[a-f0-9]{24}$/);
    for (const collection of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.dropCollection(collection.name);
    assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
  } finally { await mongoose.disconnect(); } });
  await Promise.all([repository.initialize(), formsRepository.initialize(), leadsRepository.initialize(), ordersRepository.initialize(), notificationsRepository.initialize()]);
  const auth = { async authorizeStaff(store, identity, roles) { assert.ok(roles.includes(identity.role)); return { _id: identity.userId }; } };
  const staff = { role: 'superAdmin', userId: 'a'.repeat(24) }, messages = [];
  let failEnqueue = false, failSmtp = false, clock = new Date(), leads, orders;
  const now = () => new Date(clock), config = { smtp: {}, notificationLinks: {
    b2c: 'https://shop.example/orders/{id}#token={token}', b2b: 'https://business.example/requests/{id}#token={token}' } };
  const queue = { ...repository, async enqueue(data, session) { await repository.enqueue(data, session); if (failEnqueue) throw new Error('queue write failed'); } };
  const delivery = createEmailDelivery({ config, repository: queue, now, sources: {
    b2c: id => orders.getEmailSource(id), b2b: id => leads.getEmailSource(id),
  }, email: { async sendNotification(message) { if (failSmtp) throw new Error('mock SMTP failure'); messages.push(message); } } });
  const inbox = createNotificationsService({ auth, now });
  const events = { async enqueue(data, session) { await inbox.enqueue(data, session); await delivery.enqueue(data, session); } };
  const forms = createFormsService({ auth }); await forms.update('b2b', staff, 'fabric', { version: 0, isActive: true });
  leads = createLeadsService({ auth, forms, notifications: events, trackingSecret: 'synthetic-email-test-key', now });
  const draft = await leads.prepare('b2b', null, 'fabric'), input = { draftId: draft.draftId, formVersion: 1, contact: { ...leadContact, email: 'lead@example.com' } };
  failEnqueue = true; await assert.rejects(leads.submit('b2b', null, draft.draftToken, input, 'ar'), /queue write failed/);
  assert.equal(await Lead.countDocuments(), 0); assert.equal(await EmailDelivery.countDocuments(), 0); assert.equal(await Notification.countDocuments(), 0);
  failEnqueue = false;
  const submitted = await Promise.all([leads.submit('b2b', null, draft.draftToken, input, 'ar'), leads.submit('b2b', null, draft.draftToken, input, 'en')]);
  assert.equal(submitted.filter(row => row.created).length, 1); assert.equal(await EmailDelivery.countDocuments(), 1);
  assert.equal(await Notification.countDocuments({ store: 'b2b' }), 1);
  const leadId = submitted[0].lead.id, locale = (await Lead.findById(leadId).lean()).notificationLocale;
  await Promise.all([leads.contacted('b2b', staff, leadId), leads.contacted('b2b', staff, leadId)]);
  assert.equal(await EmailDelivery.countDocuments(), 2); assert.ok((await EmailDelivery.find().lean()).every(row => row.locale === locale));
  assert.equal(await Notification.countDocuments({ store: 'b2b' }), 1);
  const stocks = mongoose.connection.collection('email_test_stock'), baskets = mongoose.connection.collection('email_test_baskets');
  const productId = new mongoose.Types.ObjectId(); await stocks.insertOne({ _id: productId, stock: 10 }); await baskets.insertOne({ _id: 'guest', quantity: 2 });
  const cart = { async checkoutOwner() { return { ownerKey: 'g:synthetic-owner', userId: null }; },
    async getForCoupon(store, owner, { session }) { const basket = await baskets.findOne({ _id: 'guest' }, { session });
      return { canCheckout: Boolean(basket), subtotal: 20000, items: [{ productId: String(productId), variantId: null,
        name: { ar: 'قميص', en: 'Shirt' }, slug: 'shirt', values: null, sku: null, quantity: 2,
        price: 10000, discountedPrice: null, unitPrice: 10000, lineTotal: 20000, activeSale: null }] }; },
    async consumeForOrder(store, owner, session) { await baskets.deleteOne({ _id: 'guest' }, { session }); } };
  const products = { async getOrderCategories() { return []; }, async lockForCart() {}, async adjustOrderStock(store, items, { session, restore = false }) {
    await stocks.updateOne({ _id: productId }, { $inc: { stock: restore ? 2 : -2 } }, { session }); } };
  orders = createOrdersService({ auth, cart, products, shipping: { async resolve() { return { fee: 5000, name: { ar: 'افتراضي', en: 'Default' } }; } },
    trackingSecret: 'synthetic-email-test-key', notifications: events, now });
  const preview = await orders.preview('b2c', {}, checkoutInput()); failEnqueue = true;
  await assert.rejects(orders.place('b2c', {}, { checkoutId: preview.checkoutId }, 'ar'), /queue write failed/);
  assert.equal(await Order.countDocuments(), 0); assert.equal((await stocks.findOne({ _id: productId })).stock, 10);
  assert.ok(await baskets.findOne({ _id: 'guest' })); assert.equal(await EmailDelivery.countDocuments(), 2);
  assert.equal(await Notification.countDocuments({ store: 'b2c' }), 0);
  failEnqueue = false;
  const placed = await Promise.all([orders.place('b2c', {}, { checkoutId: preview.checkoutId }, 'ar'), orders.place('b2c', {}, { checkoutId: preview.checkoutId }, 'ar')]);
  assert.equal(placed.filter(row => row.created).length, 1); assert.equal(await Order.countDocuments(), 1); assert.equal(await EmailDelivery.countDocuments(), 3);
  assert.equal(await Notification.countDocuments({ store: 'b2c' }), 1);
  const orderId = placed[0].order.id; assert.equal((await stocks.findOne({ _id: productId })).stock, 8); assert.equal(await baskets.findOne({ _id: 'guest' }), null);
  await Promise.all([orders.changeStatus('b2c', staff, orderId, { status: 'canceled', expectedStatus: 'pending' }, 'en'),
    orders.changeStatus('b2c', staff, orderId, { status: 'canceled', expectedStatus: 'pending' }, 'en')]);
  assert.equal(await EmailDelivery.countDocuments(), 4); assert.equal((await stocks.findOne({ _id: productId })).stock, 10);
  assert.equal(await Notification.countDocuments(), 2);
  const leadInbox = await inbox.list('b2b', staff, {}, 'ar'), orderInbox = await inbox.list('b2c', staff);
  assert.equal(leadInbox.unreadCount, 1); assert.equal(leadInbox.pagination.total, 1); assert.equal(leadInbox.items[0].resource.id, leadId);
  assert.equal(leadInbox.items[0].title, 'طلب خدمة جديد'); assert.equal(orderInbox.items[0].resource.id, orderId);
  await assert.rejects(inbox.markRead('b2b', staff, orderInbox.items[0].id), { code: 'NOTIFICATION_NOT_FOUND' });
  const readRace = await Promise.all(Array.from({ length: 8 }, () => inbox.markRead('b2b', staff, leadInbox.items[0].id)));
  assert.ok(readRace.every(row => row.readAt === readRace[0].readAt)); assert.equal(await NotificationRead.countDocuments(), 1);
  assert.equal((await inbox.unreadCount('b2b', staff)).unreadCount, 0);
  assert.equal((await inbox.list('b2b', staff, { unreadOnly: true })).pagination.total, 0);
  const secondViewer = { role: 'moderator', userId: 'b'.repeat(24) };
  assert.equal((await inbox.list('b2b', secondViewer, { unreadOnly: true })).items.length, 1);
  assert.equal((await inbox.unreadCount('b2b', secondViewer)).unreadCount, 1);
  await inbox.markRead('b2b', secondViewer, leadInbox.items[0].id); assert.equal(await NotificationRead.countDocuments(), 2);
  assert.equal((await inbox.unreadCount('b2c', staff)).unreadCount, 1);
  assert.equal((await inbox.list('b2c', staff, { page: 2, limit: 1 })).items.length, 0);
  const failingInbox = createNotificationsService({ repository: { ...notificationsRepository, async enqueue(data, session) {
    await notificationsRepository.enqueue(data, session); throw new Error('staff inbox write failed'); } } });
  const failedLeadService = createLeadsService({ auth, forms, trackingSecret: 'synthetic-email-test-key', notifications: failingInbox, now });
  const failedDraft = await failedLeadService.prepare('b2b', null, 'fabric');
  await assert.rejects(failedLeadService.submit('b2b', null, failedDraft.draftToken, { ...input, draftId: failedDraft.draftId }), /staff inbox write failed/);
  assert.equal(await Lead.countDocuments(), 1); assert.equal(await Notification.countDocuments(), 2);
  const noEmailDraft = await leads.prepare('b2b', null, 'fabric');
  const noEmailLead = await leads.submit('b2b', null, noEmailDraft.draftToken, { ...input, draftId: noEmailDraft.draftId, contact: leadContact });
  assert.equal(await Notification.countDocuments(), 3); assert.equal(await EmailDelivery.countDocuments(), 4);
  assert.equal((await inbox.list('b2b', staff)).pagination.total, 2);
  assert.ok((await inbox.list('b2b', staff)).items.some(row => row.resource.id === noEmailLead.lead.id));
  failSmtp = true; assert.equal((await delivery.drain()).failed, 1); assert.equal((await Order.findById(orderId).lean()).status, 'canceled');
  failSmtp = false; clock = new Date(clock.getTime() + 60001);
  await Promise.all([delivery.drain(), delivery.drain()]); assert.equal(messages.length, 4); assert.equal(await EmailDelivery.countDocuments({ state: 'sent' }), 4);
  assert.ok(messages.some(mail => mail.text.includes(placed[0].trackingToken))); assert.ok(!JSON.stringify(await EmailDelivery.find().lean()).includes(placed[0].trackingToken));
  const pending = { store: 'b2c', resourceId: new mongoose.Types.ObjectId(), event: 'order.placed', resourceStatus: 'pending',
    eventAt: now(), nextAttemptAt: now(), to: 'buyer@example.com', locale: 'en', state: 'pending', attempts: 0 };
  await runTransaction(session => repository.enqueue(pending, session));
  const first = await repository.claim(['b2c'], now(), 'old'); assert.ok(first); assert.equal(await repository.claim(['b2c'], now(), 'second'), null);
  clock = new Date(clock.getTime() + 120001); const reclaimed = await repository.claim(['b2c'], now(), 'new'); assert.equal(String(reclaimed._id), String(first._id));
  assert.equal((await repository.finish(first._id, 'old', { state: 'sent' })).matchedCount, 0);
  assert.equal((await repository.finish(first._id, 'new', { state: 'failed' })).matchedCount, 1);
  await repository.retryFailed(['b2b']); assert.equal((await EmailDelivery.findById(first._id).lean()).state, 'failed');
  await repository.retryFailed(['b2c']); assert.equal((await EmailDelivery.findById(first._id).lean()).state, 'pending');
});
