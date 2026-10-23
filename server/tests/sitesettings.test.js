import test from 'node:test';
import assert from 'node:assert/strict';
import { sitesettingsFixture, settingsInput } from './helpers/sitesettings.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { SiteSettings } from '../src/modules/sitesettings/sitesettings.model.js';
import { sitesettingsRepository } from '../src/modules/sitesettings/sitesettings.repository.js';
import { createSitesettingsService } from '../src/modules/sitesettings/sitesettings.service.js';

const identity = { userId: 'a'.repeat(24), role: 'admin' };
const auth = { async authorizeStaff(store, actor, roles) {
  if (actor.store && actor.store !== store || !roles.includes(actor.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: actor.userId };
} };

test('site settings return complete independent defaults without writing and merge localized edits safely', async () => {
  const f = sitesettingsFixture(auth);
  for (const store of ['b2c', 'b2b']) {
    const publicSettings = await f.settings.getPublic(store, 'ar'), admin = await f.settings.getStaff(store, identity);
    assert.equal(publicSettings.seo.title, 'نارمر'); assert.equal(admin.version, 0);
    assert.equal(publicSettings.updatedAt, null); assert.equal(publicSettings.phone, null); assert.equal(publicSettings.address, '');
    assert.equal(Object.hasOwn(publicSettings, 'version'), false);
  }
  assert.equal(f.rows.size, 0);
  const saved = await f.settings.update('b2c', identity, settingsInput);
  assert.equal(saved.version, 1); assert.equal(saved.phone, '+201001234567'); assert.equal(saved.email, 'info@example.test');
  assert.equal((await f.settings.getStaff('b2b', identity)).version, 0);
  const patch = await f.settings.update('b2c', identity, { version: 1, address: { en: '' },
    social: { instagramUrl: '' }, seo: { description: { ar: '' }, keywords: '' } });
  assert.equal(patch.address.ar, settingsInput.address.ar); assert.equal(patch.social.instagramUrl, null);
  assert.equal(patch.social.facebookUrl, settingsInput.social.facebookUrl);
  assert.equal((await f.settings.getPublic('b2c', 'en')).address, settingsInput.address.ar);
  assert.equal((await f.settings.getPublic('b2c', 'ar')).seo.description, settingsInput.seo.description.en);
  const cleared = await f.settings.update('b2c', identity, { version: 2, phone: null, email: null, mapUrl: null });
  assert.equal(cleared.phone, null); assert.equal(cleared.email, null); assert.equal(cleared.mapUrl, null);
  assert.equal(f.audits.length, 3); assert.deepEqual(f.audits.at(-1).fields, ['phone', 'email', 'mapUrl']);
  assert.equal(Object.hasOwn(cleared, 'actorId'), false);
});

test('site links admit declared platform/short hosts only and reject unsafe or misleading URLs', async () => {
  const f = sitesettingsFixture(auth); let version = 0;
  for (const value of ['https://maps.google.com/?q=example','https://maps.app.goo.gl/example','https://goo.gl/maps/example','https://maps.apple.com/?q=example','https://google.com.eg/maps/place/example']) {
    const saved = await f.settings.update('b2c', identity, { version, mapUrl: value }); version = saved.version;
  }
  for (const value of ['javascript:alert(1)','data:text/html,hello','//google.com/maps','http://www.google.com/maps',
    'https://google.com.evil.test/maps','https://user:pass@www.google.com/maps','https://www.google.com:8443/maps',
    'https://127.0.0.1/maps','https://www.google.com/search','https://goo.gl/random','https://www.google.com\\@evil.test/maps',
    'https://www.google.com/maps\n?x=1','https://www.google.com./maps']) {
    await assert.rejects(f.settings.update('b2c', identity, { version, mapUrl: value }), { code: 'VALIDATION_ERROR' }, value);
  }
  for (const field of ['instagramUrl','whatsappUrl','tiktokUrl','facebookUrl']) {
    await assert.rejects(f.settings.update('b2c', identity, { version, social: { [field]: 'https://example.test/profile' } }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(f.settings.update('b2c', identity, { version, social: { [field]: 'https://www.instagram.com.evil.test/' } }), { code: 'VALIDATION_ERROR' });
  }
  assert.equal((await f.settings.getStaff('b2c', identity)).version, version);
});

test('singleton saves have one version winner, audit failures roll back and overflow never overwrites', async () => {
  const f = sitesettingsFixture(auth);
  const attempts = await Promise.allSettled([f.settings.update('b2c', identity, { version: 0, phone: '01001234567' }),
    f.settings.update('b2c', identity, { version: 0, phone: '01111234567' })]);
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(row => row.status === 'rejected').reason.code, 'SITE_SETTINGS_CONFLICT');
  f.failAudit(true);
  await assert.rejects(f.settings.update('b2c', identity, { version: 1, phone: null }), /settings audit failed/);
  assert.equal((await f.settings.getStaff('b2c', identity)).version, 1); assert.equal(f.audits.length, 1);
  await assert.rejects(f.settings.update('b2b', identity, { version: 0, phone: null }), /settings audit failed/);
  assert.equal(f.rows.has('b2b'), false);
  f.failAudit(false); f.rows.get('b2c').version = Number.MAX_SAFE_INTEGER;
  await assert.rejects(f.settings.update('b2c', identity, { version: Number.MAX_SAFE_INTEGER, phone: null }), { code: 'SITE_SETTINGS_CONFLICT' });
  const duplicate = createSitesettingsService({ auth, transaction: work => work({}), repository: { async find() { return null; },
    async create() { throw Object.assign(new Error('duplicate'), { code: 11000 }); } } });
  await assert.rejects(duplicate.update('b2c', identity, { version: 0, phone: null }), { code: 'SITE_SETTINGS_CONFLICT' });
});

test('settings reject unknown/null nested edits, enforce store/roles and keep Mongo writes scoped', async () => {
  const f = sitesettingsFixture(auth);
  for (const input of [{ version: 0 }, { version: '0', phone: null }, { version: 0, booking: true },
    { version: 0, social: null }, { version: 0, seo: [] }, { version: 0, address: {} },
    { version: 0, seo: { title: { en: '' } } }, { version: 0, seo: { title: null } },
    { version: 0, seo: { keywords: null } }, { version: 0, social: { youtubeUrl: 'https://example.test' } },
    { version: 0, address: { fr: 'No' } }, { version: 0, phone: '' }, { version: 0, email: 'invalid' },
    { version: -1, phone: null }, { version: 0.5, phone: null }, { version: Number.MAX_SAFE_INTEGER + 1, phone: null },
    { version: 0, phone: '1'.repeat(16) }, { version: 0, phone: '('.repeat(101) + '123456' },
    { version: 0, email: 'a'.repeat(245) + '@example.test' },
    { version: 0, address: { en: 'a'.repeat(1001) } }, { version: 0, seo: { title: { ar: 'ا'.repeat(201) } } },
    { version: 0, seo: { description: { en: 'a'.repeat(501) } } }, { version: 0, seo: { keywords: 'a'.repeat(1001) } },
    { version: 0, mapUrl: 'https://maps.google.com/' + 'a'.repeat(2048) }]) {
    await assert.rejects(f.settings.update('b2c', identity, input), { code: 'VALIDATION_ERROR' }, JSON.stringify(input));
  }
  for (const role of ['user','moderator']) await assert.rejects(f.settings.getStaff('b2c', { ...identity, role }), { code: 'FORBIDDEN' });
  await assert.rejects(f.settings.getPublic('invalid'), { code: 'INVALID_STORE' });
  await assert.rejects(f.settings.update('b2b', { ...identity, store: 'b2c' }, { version: 0, phone: null }), { code: 'FORBIDDEN' });
  const query = sitesettingsRepository.update('b2b', 3, { phone: null }, { marker: true });
  assert.equal(query.getFilter()._id, 'b2b'); assert.equal(query.getFilter().version, 3); assert.equal(query.getUpdate().$inc.version, 1);
  assert.equal(SiteSettings.schema.path('_id').instance, 'String');
});
