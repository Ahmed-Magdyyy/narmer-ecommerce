import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/shared/errors/app-error.js';
import { createNotificationsService } from '../src/modules/notifications/notifications.service.js';
import { notificationsFixture } from './helpers/notifications.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { createLeadsService } from '../src/modules/leads/leads.service.js';

const staff = { userId: 'a'.repeat(24), role: 'admin', store: 'b2b' }, other = { ...staff, userId: 'b'.repeat(24), role: 'moderator' };
const auth = { async authorizeStaff(store, identity, roles) { if (identity.store !== store) throw new AppError(401, 'UNAUTHORIZED');
  if (!roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN'); return { _id: identity.userId }; } };
const event = (store = 'b2b', resourceId = '1'.repeat(24)) => ({ store, event: store === 'b2b' ? 'lead.submitted' : 'order.placed',
  resourceId, eventAt: new Date(), to: 'excluded@example.com', locale: 'en', trackingToken: 'excluded-private-token' });

test('staff notifications deduplicate creation, localize sparse DTOs and isolate store/personal read state', async () => {
  const f = notificationsFixture(auth);
  assert.deepEqual(await f.service.list('b2b', staff), { items: [], unreadCount: 0, pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  assert.equal(f.rows.size, 0); assert.equal(f.reads.size, 0);
  await Promise.all([f.service.enqueue(event(), {}), f.service.enqueue(event(), {})]); await f.service.enqueue(event('b2c'), {});
  assert.equal(f.rows.size, 2); assert.ok(!JSON.stringify([...f.rows.values()]).includes('excluded'));
  const list = await f.service.list('b2b', staff, {}, 'ar'); const id = list.items[0].id;
  assert.equal(list.items[0].title, 'طلب خدمة جديد'); assert.deepEqual(list.items[0].resource, { type: 'lead', id: '1'.repeat(24) });
  assert.equal(list.unreadCount, 1); assert.equal(list.items[0].readAt, null);
  const read = await f.service.markRead('b2b', staff, id); f.advance(1000);
  assert.deepEqual(await f.service.markRead('b2b', staff, id), read); assert.equal(f.reads.size, 1);
  assert.deepEqual(await f.service.unreadCount('b2b', staff), { unreadCount: 0 });
  assert.deepEqual(await f.service.unreadCount('b2b', other), { unreadCount: 1 });
  assert.equal((await f.service.list('b2b', staff, { unreadOnly: true })).pagination.total, 0);
  assert.equal((await f.service.list('b2b', other)).items[0].isRead, false);
  const foreign = [...f.rows.values()].find(row => row.store === 'b2c');
  await assert.rejects(f.service.markRead('b2b', staff, foreign._id), { code: 'NOTIFICATION_NOT_FOUND' });
  await assert.rejects(f.service.list('b2b', { ...staff, role: 'user' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.list('b2c', staff), { code: 'UNAUTHORIZED' });
});

test('staff event writes require correct transactions and ignore status/contact events; duplicate read races recover safely', async () => {
  const f = notificationsFixture(auth);
  await assert.rejects(f.service.enqueue(event()), /transaction/);
  await assert.rejects(f.service.enqueue({ ...event(), store: 'b2c' }, {}), /transaction/);
  await f.service.enqueue({ ...event(), event: 'lead.contacted' }, {}); await f.service.enqueue({ ...event('b2c'), event: 'order.status' }, {});
  assert.equal(f.rows.size, 0); await f.service.enqueue(event(), {}); const id = [...f.rows.keys()][0];
  await f.service.markRead('b2b', staff, id);
  const raced = createNotificationsService({ auth, repository: { ...f.repository, async markRead() { throw Object.assign(new Error('duplicate'), { code: 11000 }); } } });
  assert.equal((await raced.markRead('b2b', staff, id)).isRead, true);
  await assert.rejects(raced.markRead('b2b', other, id), { code: 11000 });
});

test('Lead creation rolls back on staff notification failure and replay/contact actions never duplicate arrival events', async () => {
  const f = leadsFixture(auth), n = notificationsFixture(auth), admin = { ...staff, role: 'superAdmin' };
  await f.forms.update('b2b', admin, 'fabric', { version: 0, isActive: true });
  const leads = createLeadsService({ ...f.options, notifications: n.service, transaction: n.transaction(f.transaction) });
  const draft = await leads.prepare('b2b', null, 'fabric'), input = { draftId: draft.draftId, formVersion: 1, contact: leadContact };
  n.fail(true); await assert.rejects(leads.submit('b2b', null, draft.draftToken, input), /notification write failed/);
  assert.equal(f.leadRows.size, 0); assert.equal(n.rows.size, 0); assert.equal(f.draftRows.get(draft.draftId).status, 'open');
  n.fail(false); const receipt = await leads.submit('b2b', null, draft.draftToken, input);
  await leads.submit('b2b', null, draft.draftToken, input); await leads.contacted('b2b', admin, receipt.lead.id);
  assert.equal(n.rows.size, 1); assert.equal((await n.service.list('b2b', staff)).items[0].resource.id, receipt.lead.id);
  await n.service.markRead('b2b', staff, [...n.rows.keys()][0]); assert.equal(f.leadRows.get(receipt.lead.id).status, 'contacted');
});
