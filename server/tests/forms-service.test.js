import test from 'node:test';
import assert from 'node:assert/strict';
import { formsFixture, textField, choiceField } from './helpers/forms.js';

const staff = { userId: 'a'.repeat(24), role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== 'b2b' || !identity || !roles.includes(identity.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
  return { _id: identity.userId };
} };

test('Forms begins unpublished, protects fixed contacts, and localizes public definitions after publishing', async () => {
  const f = formsFixture(auth);
  assert.equal((await f.forms.list('b2b', staff)).items.length, 5);
  assert.deepEqual((await f.forms.browse('b2b')).items, []);
  await assert.rejects(f.forms.getPublic('b2b', 'spinning'), { code: 'FORM_NOT_FOUND' });
  const updated = await f.forms.update('b2b', staff, 'spinning', { version: 0, isActive: true,
    title: { en: 'Spinning requests' }, helpText: { en: 'Describe your material.' }, fields: [textField(), choiceField()] });
  assert.equal(updated.version, 1);
  assert.deepEqual(updated.title, { ar: 'الغزل', en: 'Spinning requests' });
  assert.equal(updated.fields[0].choices.length, 0);
  assert.deepEqual(updated.fields[0].constraints, { minLength: 1, maxLength: 5000 });
  const publicForm = await f.forms.getPublic('b2b', 'spinning', 'ar');
  assert.equal(publicForm.fields[0].label, 'وصف الخامة');
  assert.equal(publicForm.fields[1].choices[0].label, 'قطن');
  assert.equal(publicForm.helpText, 'Describe your material.');
  assert.deepEqual(publicForm.fixedFields.map(field => [field.key, field.required]),
    [['name', true], ['phone', true], ['email', false], ['governorate', true], ['district', true]]);
  updated.fixedFields[0].label.en = 'Mutated';
  assert.equal((await f.forms.getStaff('b2b', staff, 'spinning')).fixedFields[0].label.en, 'Name');
  assert.equal(f.audits[0].previousVersion, 0);
  assert.equal(f.audits[0].version, 1);
  assert.deepEqual(f.audits[0].fields, ['title', 'helpText', 'isActive', 'fields']);
});

test('Forms replaces ordered configurable fields, supports six types, and retires without deleting data', async () => {
  const f = formsFixture(auth);
  const fields = [textField(), { ...textField('description'), type: 'text' },
    { ...textField('quantity'), type: 'number', required: true }, choiceField(),
    { ...choiceField('multiselect'), key: 'materials' }, { ...textField('has-material'), type: 'boolean' }];
  await f.forms.update('b2b', staff, 'fabric', { version: 0, isActive: true, fields });
  const read = await f.forms.getStaff('b2b', staff, 'fabric');
  assert.deepEqual(read.fields.map(field => field.type), ['textarea', 'text', 'number', 'select', 'multiselect', 'boolean']);
  await f.forms.update('b2b', staff, 'fabric', { version: 1, fields: [fields[2], fields[0]] });
  assert.deepEqual((await f.forms.getStaff('b2b', staff, 'fabric')).fields.map(field => field.key), ['quantity', 'material-description']);
  await f.forms.update('b2b', staff, 'fabric', { version: 2, isActive: false });
  await assert.rejects(f.forms.getPublic('b2b', 'fabric'), { code: 'FORM_NOT_FOUND' });
  assert.equal((await f.forms.getStaff('b2b', staff, 'fabric')).fields.length, 2);
  assert.equal((await f.forms.list('b2b', staff)).items.length, 5);
  await f.forms.update('b2b', staff, 'fabric', { version: 3, fields: [] });
  assert.equal((await f.forms.getStaff('b2b', staff, 'fabric')).fields.length, 0);
});

test('Forms rejects invalid configuration, reserved contacts, unsafe keys and unsupported rules', async () => {
  const f = formsFixture(auth);
  const badFields = [
    [null], [{ ...textField(), key: 'name' }], [{ ...textField(), key: 'constructor' }],
    [textField(), textField()], [{ ...textField(), type: 'date' }], [{ ...textField(), required: 'false' }],
    [{ ...textField(), choices: null }], [{ ...textField(), label: { en: 'Only one' } }],
    [{ ...textField(), script: 'alert(1)' }], [{ ...textField(), constraints: { maxLength: 100000 } }],
    [{ ...choiceField(), choices: [] }], [{ ...choiceField(), choices: [choiceField().choices[0], choiceField().choices[0]] }],
    [{ ...choiceField(), choices: [{ key: '__proto__', label: { ar: 'أ', en: 'A' } }] }],
    [{ ...textField(), label: { ar: 'أ', en: null } }], [{ ...textField(), choices: choiceField().choices }],
    Array.from({ length: 41 }, (_, i) => textField(`field-${i}`)),
  ];
  for (const fields of badFields) await assert.rejects(f.forms.update('b2b', staff, 'spinning', { version: 0, fields }), { code: 'INVALID_FORM' });
  for (const input of [{ version: 0 }, { version: 0, fixedFields: [] }, { version: 0, type: 'fabric' },
    { version: 0, title: { en: null } }, { version: 0, title: { en: ' ' } },
    { version: 0, title: { ar: 'أ', en: 'A', fr: 'B' } }, { version: 0, helpText: { en: 'a'.repeat(2001) } }]) {
    await assert.rejects(f.forms.update('b2b', staff, 'spinning', input), { code: 'INVALID_FORM' });
  }
  assert.equal(f.audits.length, 0);
});

test('Forms rejects competing versions, rolls back audit failures and enforces business-area roles', async () => {
  const f = formsFixture(auth);
  const race = await Promise.allSettled([
    f.forms.update('b2b', staff, 'weaving', { version: 0, isActive: true }),
    f.forms.update('b2b', staff, 'weaving', { version: 0, fields: [textField()] }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'FORM_CONFLICT');
  const before = await f.forms.getStaff('b2b', staff, 'weaving');
  f.failAudit(true);
  await assert.rejects(f.forms.update('b2b', staff, 'weaving', { version: 1, title: { en: 'Unsaved' } }), /form audit failed/);
  assert.deepEqual(await f.forms.getStaff('b2b', staff, 'weaving'), before);
  assert.equal(f.audits.length, 1);
  await assert.rejects(f.forms.browse('b2c'), { code: 'INVALID_STORE' });
  for (const role of ['user', 'moderator']) await assert.rejects(f.forms.list('b2b', { ...staff, role }), { code: 'FORBIDDEN' });
  await assert.rejects(f.forms.getPublic('b2b', 'unknown'), { code: 'INVALID_FORM' });
});

test('Forms submission snapshot requires an active current version and remains unchanged after later edits', async () => {
  const f = formsFixture(auth);
  await f.forms.update('b2b', staff, 'fabric', { version: 0, isActive: true, fields: [textField()] });
  const snapshot = await f.transaction(session => f.forms.getForSubmission('b2b', 'fabric', 1, session));
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.fields[0].label.en, 'Material description');
  await f.forms.update('b2b', staff, 'fabric', { version: 1, fields: [] });
  assert.equal(snapshot.fields.length, 1);
  await assert.rejects(f.transaction(session => f.forms.getForSubmission('b2b', 'fabric', 1, session)), { code: 'FORM_CONFLICT' });
  await f.forms.update('b2b', staff, 'fabric', { version: 2, isActive: false });
  await assert.rejects(f.transaction(session => f.forms.getForSubmission('b2b', 'fabric', 3, session)), { code: 'FORM_NOT_FOUND' });
});
