import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AppError } from '../src/shared/errors/app-error.js';
import { createLeadsService } from '../src/modules/leads/leads.service.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { textField, choiceField } from './helpers/forms.js';
import { nativeInput, offerInput } from './helpers/wholesale.js';

const staff = { store: 'b2b', userId: 'a'.repeat(24), role: 'superAdmin' }, moderator = { ...staff, userId: 'b'.repeat(24), role: 'moderator' }, customer = { ...staff, userId: 'c'.repeat(24), role: 'user' };
const auth = { async authorizeStaff(store, identity, roles) { if (!identity || identity.store !== store) throw new AppError(401, 'UNAUTHORIZED'); if (!roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN'); return { _id: identity.userId }; } };
async function setup(type = 'fabric') {
  const f = leadsFixture(auth);
  await f.forms.update('b2b', staff, type, { version: 0, isActive: true, fields: [textField(), choiceField(),
    { ...textField('quantity'), type: 'number', required: true }, { ...textField('owns-material'), type: 'boolean', required: true }] });
  const draft = await f.leads.prepare('b2b', null, type);
  const input = { draftId: draft.draftId, formVersion: 1, contact: leadContact, answers: { 'material-type': 'cotton', quantity: 0, 'owns-material': false } };
  return { f, draft, input };
}
test('Leads guest submission snapshots, concurrent replay, payload conflict and original tracking survive form/key changes', async () => {
  const { f, draft, input } = await setup();
  const results = await Promise.all([f.leads.submit('b2b', null, draft.draftToken, input), f.leads.submit('b2b', null, draft.draftToken, input)]);
  assert.equal(results.filter(row => row.created).length, 1); assert.equal(f.leadRows.size, 1);
  assert.equal(results[0].lead.id, results[1].lead.id); assert.equal(results[0].trackingToken, results[1].trackingToken);
  assert.equal(results[0].lead.contact.phone, '+201001234567'); assert.equal(results[0].lead.contact.email, null);
  assert.equal(results[0].lead.answers.quantity, 0); assert.equal(results[0].lead.answers['owns-material'], false);
  assert.ok(!JSON.stringify(results).includes('draftTokenHash'));
  await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, { ...input, contact: { ...leadContact, name: 'Changed' } }), { code: 'LEAD_REQUEST_CONFLICT' });
  await assert.rejects(f.leads.track('b2b', results[0].lead.id, 'x'.repeat(43)), { code: 'LEAD_NOT_FOUND' });
  await f.forms.update('b2b', staff, 'fabric', { version: 1, fields: [], isActive: false });
  assert.equal((await f.leads.track('b2b', results[0].lead.id, results[0].trackingToken)).form.fields.length, 4);
  const rotated = createLeadsService({ ...f.options, trackingSecret: 'another-signing-secret-at-least-32-bytes' });
  assert.equal((await rotated.submit('b2b', null, draft.draftToken, input)).trackingToken, null);
  assert.equal((await rotated.track('b2b', results[0].lead.id, results[0].trackingToken)).id, results[0].lead.id);
  f.advance(90 * 86400000); await assert.rejects(f.leads.track('b2b', results[0].lead.id, results[0].trackingToken), { code: 'LEAD_NOT_FOUND' });
  await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, input), { code: 'LEAD_NOT_FOUND' });
});
test('Leads rejects invalid answers/contacts and stale versions, and failed creation rolls back form/draft state', async () => {
  const { f, draft, input } = await setup();
  for (const answer of [{}, { ...input.answers, unexpected: 'x' }, { ...input.answers, 'material-type': 'invalid' }, { ...input.answers, quantity: '1' }, { ...input.answers, 'owns-material': 'false' }]) {
    await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, { ...input, answers: answer }), { code: 'INVALID_LEAD' });
  }
  await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, { ...input, contact: { ...leadContact, district: '' } }), { code: 'INVALID_LEAD' });
  await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, { ...input, formVersion: 0 }), { code: 'FORM_CONFLICT' });
  f.failCreate(true); await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, input), /lead write failed/);
  assert.equal(f.draftRows.get(draft.draftId).status, 'open'); assert.equal(f.leadRows.size, 0);
  f.failCreate(false); assert.equal((await f.leads.submit('b2b', null, draft.draftToken, input)).created, true);
});
test('Leads owns customer history and staff contacting is idempotent with audit rollback', async () => {
  const { f, draft, input } = await setup();
  const receipt = await f.leads.submit('b2b', customer, draft.draftToken, input);
  assert.equal(receipt.trackingToken, null); assert.equal((await f.leads.list('b2b', customer, {}, 'en')).pagination.total, 1);
  await assert.rejects(f.leads.get('b2b', { ...customer, userId: 'd'.repeat(24) }, receipt.lead.id), { code: 'LEAD_NOT_FOUND' });
  f.failAudit(true); await assert.rejects(f.leads.contacted('b2b', moderator, receipt.lead.id), /lead audit failed/);
  assert.equal(f.leadRows.get(receipt.lead.id).status, 'submitted'); f.failAudit(false);
  const marked = await f.leads.contacted('b2b', moderator, receipt.lead.id); f.advance(1000);
  assert.deepEqual(await f.leads.contacted('b2b', staff, receipt.lead.id), marked); assert.equal(f.audits.length, 1);
  await assert.rejects(f.leads.contacted('b2b', customer, receipt.lead.id), { code: 'FORBIDDEN' });
});
test('Leads attaches private images, restricts reading to staff and cleanup preserves attached assets', async () => {
  const { f, draft, input } = await setup();
  const bytes = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  const image = await f.leads.upload('b2b', null, draft.draftId, draft.draftToken, bytes, 'image/png');
  assert.deepEqual(Object.keys(image).sort(), ['height', 'id', 'width']);
  await assert.rejects(f.leads.submit('b2b', null, 'x'.repeat(43), input), { code: 'LEAD_DRAFT_UNAVAILABLE' });
  const second = await f.leads.prepare('b2b', null, 'fabric');
  await assert.rejects(f.leads.submit('b2b', null, second.draftToken, { ...input, draftId: second.draftId, imageIds: [image.id] }), { code: 'LEAD_IMAGE_CONFLICT' });
  const receipt = await f.leads.submit('b2b', null, draft.draftToken, { ...input, imageIds: [image.id] });
  assert.equal(receipt.lead.imageCount, 1); assert.ok(!Object.hasOwn(receipt.lead, 'imageIds'));
  await assert.rejects(f.leads.readImage('b2b', customer, receipt.lead.id, image.id), { code: 'FORBIDDEN' });
  assert.equal((await sharp(await f.leads.readImage('b2b', moderator, receipt.lead.id, image.id)).metadata()).format, 'webp');
  f.advance(2 * 86400000); assert.deepEqual(await f.leads.cleanupImages(), { removed: 0, failed: 0 }); assert.equal(f.objects.size, 1);
});
test('Leads failed upload releases capacity with delayed cleanup and concurrent uploads enforce five-image cap', async () => {
  const { f, draft } = await setup();
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
  f.failUpload(true); await assert.rejects(f.leads.upload('b2b', null, draft.draftId, draft.draftToken, bytes, 'image/png'), { code: 'LEAD_STORAGE_FAILED' });
  assert.equal(f.draftRows.get(draft.draftId).imageSlots, 0); assert.deepEqual(await f.leads.cleanupImages(), { removed: 0, failed: 0 });
  f.failUpload(false);
  const race = await Promise.allSettled(Array.from({ length: 6 }, () => f.leads.upload('b2b', null, draft.draftId, draft.draftToken, bytes, 'image/png')));
  assert.equal(race.filter(row => row.status === 'fulfilled').length, 5); assert.equal(race.find(row => row.status === 'rejected').reason.code, 'LEAD_IMAGE_LIMIT');
  f.advance(2 * 86400000); f.failRemove(true); assert.equal((await f.leads.cleanupImages()).failed, 1);
  f.failRemove(false); assert.equal((await f.leads.cleanupImages()).removed, 6); assert.equal(f.objects.size, 0);
});
test('Leads snapshots wholesale quantities and protects historical offers without stock or checkout', async () => {
  const { f, draft, input } = await setup('wholesale');
  const native = await f.wholesale.createProduct('b2b', staff, nativeInput);
  const offer = await f.wholesale.createOffer('b2b', staff, { ...offerInput('b2b', native.id), isActive: true });
  await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, input), { code: 'INVALID_LEAD' });
  const body = { ...input, wholesaleRequests: [{ offerId: offer.id, version: 0, quantity: 2 }] };
  const receipt = await f.leads.submit('b2b', null, draft.draftToken, body);
  assert.equal(receipt.lead.wholesaleRequests[0].quantity, 2); assert.equal(receipt.lead.wholesaleRequests[0].piecesPerPouch, 30);
  await assert.rejects(f.wholesale.removeOffer('b2b', staff, offer.id), { code: 'WHOLESALE_REFERENCED' });
  await f.wholesale.updateOffer('b2b', staff, offer.id, { version: 0, composition: [{ quantity: 60 }] });
  assert.equal((await f.leads.track('b2b', receipt.lead.id, receipt.trackingToken)).wholesaleRequests[0].piecesPerPouch, 30);
  assert.equal((await f.leads.submit('b2b', null, draft.draftToken, body)).created, false);
});

test('Leads defers cleanup of in-flight uploads until completion after submission, including near draft expiry', async () => {
  const { f, draft, input } = await setup();
  f.advance(86400000 - 1000);
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; }), reserved = new Promise(resolve => { started = resolve; });
  const storage = { ...f.storage, async upload(key, bytes) { started(); await waiting; return f.storage.upload(key, bytes); } };
  const leads = createLeadsService({ ...f.options, storage });
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
  const pending = leads.upload('b2b', null, draft.draftId, draft.draftToken, bytes, 'image/png');
  const checked = assert.rejects(pending, { code: 'LEAD_DRAFT_UNAVAILABLE' });
  await reserved;
  const receipt = await leads.submit('b2b', null, draft.draftToken, input);
  f.advance(2000);
  assert.deepEqual(await leads.cleanupImages(), { removed: 0, failed: 0 });
  release(); await checked;
  assert.equal(receipt.lead.imageCount, 0);
  assert.equal([...f.imageRows.values()][0].status, 'deletePending');
  assert.deepEqual(await leads.cleanupImages(), { removed: 1, failed: 0 });
  assert.equal(f.objects.size, 0);
});

test('Leads validates all six dynamic answer types and bounds without coercing false or zero', async () => {
  const f = leadsFixture(auth);
  const configured = [{ ...textField('short-note'), type: 'text' }, { ...textField('long-note'), type: 'textarea' },
    { ...textField('amount'), type: 'number' }, choiceField(), { ...choiceField('multiselect'), key: 'materials' },
    { ...textField('owns-material'), type: 'boolean' }].map(field => ({ ...field, required: true }));
  await f.forms.update('b2b', staff, 'weaving', { version: 0, isActive: true, fields: [...configured, textField('optional-note')] });
  const draft = await f.leads.prepare('b2b', null, 'weaving');
  const input = { draftId: draft.draftId, formVersion: 1, contact: leadContact, answers: {
    'short-note': ' short ', 'long-note': ' long ', amount: 0, 'material-type': 'cotton',
    materials: ['cotton', 'wool'], 'owns-material': false, 'optional-note': '   ',
  } };
  for (const patch of [{ 'short-note': 'x'.repeat(501) }, { 'short-note': ' ' }, { 'long-note': 'x'.repeat(5001) },
    { amount: Infinity }, { amount: 1000000001 }, { amount: '0' }, { 'material-type': ' cotton ' },
    { materials: ['cotton', 'cotton'] }, { materials: ['unknown'] }, { materials: [] }, { materials: 'cotton' },
    { 'owns-material': null }, { 'owns-material': 0 }]) {
    await assert.rejects(f.leads.submit('b2b', null, draft.draftToken, { ...input, answers: { ...input.answers, ...patch } }), { code: 'INVALID_LEAD' });
  }
  const saved = await f.leads.submit('b2b', null, draft.draftToken, input);
  assert.deepEqual(saved.lead.answers, { 'short-note': 'short', 'long-note': 'long', amount: 0, 'material-type': 'cotton',
    materials: ['cotton', 'wool'], 'owns-material': false });
});
