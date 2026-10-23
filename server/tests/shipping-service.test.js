import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/shared/errors/app-error.js';
import { createShippingService } from '../src/modules/shipping/shipping.service.js';
import { ShippingFee, ShippingSettings } from '../src/modules/shipping/shipping.model.js';
import { shippingRepository } from '../src/modules/shipping/shipping.repository.js';
import { shippingFixture } from './helpers/shipping.js';

const owner = { _id: '1'.repeat(24), role: 'superAdmin' };
const admin = { _id: '2'.repeat(24), role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== 'b2c' || !roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); return identity;
} };
const input = (governorateCode = 'cairo', fee = 6000) => ({ governorateCode, name: { ar: 'القاهرة', en: 'Cairo' }, fee });

test('governorate overrides and defaults resolve exactly, including zero fees and missing overrides', async () => {
  const f = shippingFixture(auth);
  assert.deepEqual(await f.shipping.getDefault('b2c', admin), { configured: false, defaultFee: null, currency: 'EGP' });
  await assert.rejects(f.shipping.resolve('b2c', 'giza'), { code: 'SHIPPING_NOT_CONFIGURED' });
  await f.shipping.setDefault('b2c', admin, { defaultFee: 8000 });
  const row = await f.shipping.create('b2c', admin, input(' CAIRO ', 0));
  const zero = await f.shipping.resolve('b2c', 'Cairo', { locale: 'ar' });
  assert.equal(zero.fee, 0);
  assert.equal(zero.source, 'override');
  assert.equal(zero.name, 'القاهرة');
  const fallback = await f.shipping.resolve('b2c', 'giza');
  assert.equal(fallback.fee, 8000);
  assert.equal(fallback.source, 'default');
  assert.equal(fallback.name, null);
  await f.shipping.remove('b2c', admin, row.id);
  assert.equal((await f.shipping.resolve('b2c', 'cairo')).fee, 8000);
  assert.equal(fallback.fee, 8000);
  await f.shipping.setDefault('b2c', owner, { defaultFee: 0 });
  assert.equal((await f.shipping.resolve('b2c', 'alexandria')).fee, 0);
});

test('shipping inputs preserve bilingual names, normalize unique codes and reject invalid money or code changes', async () => {
  const f = shippingFixture(auth);
  const row = await f.shipping.create('b2c', admin, { ...input(), store: 'b2b', currency: 'USD', name: { ...input().name, fr: 'Ignored' } });
  assert.equal(row.currency, 'EGP');
  assert.equal(row.store, undefined);
  assert.equal(row.name.fr, undefined);
  await assert.rejects(f.shipping.create('b2c', owner, input('CAIRO')), { code: 'SHIPPING_FEE_EXISTS' });
  const updated = await f.shipping.update('b2c', admin, row.id, { name: { ar: 'القاهرة الكبرى' } });
  assert.equal(updated.name.en, 'Cairo');
  assert.equal(updated.name.ar, 'القاهرة الكبرى');
  await assert.rejects(f.shipping.update('b2c', admin, row.id, { governorateCode: 'giza', fee: 1 }), { code: 'SHIPPING_CODE_IMMUTABLE' });
  for (const fee of ['6000', null, -1, 1.5, Infinity, 1000000001]) {
    await assert.rejects(f.shipping.setDefault('b2c', admin, { defaultFee: fee }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(f.shipping.update('b2c', admin, row.id, { fee }), { code: 'VALIDATION_ERROR' });
  }
  for (const code of ['', 'القاهرة', '../cairo', { $ne: null }, 'cairo district']) {
    await assert.rejects(f.shipping.create('b2c', admin, input(code)), { code: 'VALIDATION_ERROR' });
  }
  await assert.rejects(f.shipping.update('b2c', admin, row.id, {}), { code: 'VALIDATION_ERROR' });
});

test('only B2C admins/superAdmin manage fees, including the explicit override-deletion exception', async () => {
  const f = shippingFixture(auth);
  const row = await f.shipping.create('b2c', owner, input());
  for (const role of ['moderator', 'user']) {
    const identity = { ...admin, role };
    await assert.rejects(f.shipping.list('b2c', identity, {}), { code: 'FORBIDDEN' });
    await assert.rejects(f.shipping.remove('b2c', identity, row.id), { code: 'FORBIDDEN' });
    await assert.rejects(f.shipping.setDefault('b2c', identity, { defaultFee: 1 }), { code: 'FORBIDDEN' });
  }
  await assert.rejects(f.shipping.resolve('b2b', 'cairo'), { code: 'INVALID_STORE' });
  await assert.rejects(f.shipping.create('b2b', owner, input()), { code: 'INVALID_STORE' });
  await f.shipping.remove('b2c', admin, row.id);
  await assert.rejects(f.shipping.getStaff('b2c', admin, row.id), { code: 'SHIPPING_FEE_NOT_FOUND' });
});

test('failed shipping audits roll back creation, edits, deletion and default changes', async () => {
  const f = shippingFixture(auth);
  const row = await f.shipping.create('b2c', admin, input());
  await f.shipping.setDefault('b2c', admin, { defaultFee: 7000 });
  f.failAudit(true);
  await assert.rejects(f.shipping.create('b2c', admin, input('giza')), /audit failed/);
  await assert.rejects(f.shipping.update('b2c', admin, row.id, { fee: 1 }), /audit failed/);
  await assert.rejects(f.shipping.remove('b2c', admin, row.id), /audit failed/);
  await assert.rejects(f.shipping.setDefault('b2c', admin, { defaultFee: 1 }), /audit failed/);
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get(row.id).fee, 6000);
  assert.equal(f.settings.get('b2c').defaultFee, 7000);
  assert.equal(f.audits.length, 2);
});

test('shipping repository scopes writes, uses checkout sessions and enforces governorate uniqueness', async () => {
  assert.ok(ShippingFee.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.governorateCode === 1 && options.unique));
  const session = { marker: true };
  const lookup = shippingRepository.findByCode('b2c', 'cairo', session);
  assert.deepEqual(lookup.getFilter(), { store: 'b2c', governorateCode: 'cairo' });
  assert.deepEqual(lookup.getOptions().session, session);
  const mutation = shippingRepository.update('b2c', admin._id, { fee: 0 }, session);
  assert.deepEqual(mutation.getFilter(), { store: 'b2c', _id: admin._id });
  assert.deepEqual(mutation.getOptions().session, session);
  assert.deepEqual(shippingRepository.getDefault('b2c', session).getFilter(), { _id: 'b2c' });
  await assert.rejects(new ShippingSettings({ _id: 'b2c', defaultFee: null }).validate(), { name: 'ValidationError' });
  const f = shippingFixture(auth);
  const failed = createShippingService({ auth, transaction: f.transaction, repository: { ...f.repository,
    async setDefault() { throw Object.assign(new Error('duplicate'), { code: 11000 }); },
  } });
  await assert.rejects(failed.setDefault('b2c', admin, { defaultFee: 1 }), { code: 'SHIPPING_CONFLICT' });
});
