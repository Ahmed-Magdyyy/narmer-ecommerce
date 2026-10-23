import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { homepageFixture } from './helpers/homepage.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { saleInput } from './helpers/sales.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { createBunnyStorage } from '../src/shared/infrastructure/media/bunny.js';
import { homepageRepository } from '../src/modules/homepage/homepage.repository.js';
import { homepageSlots, homepageTargetId } from '../src/modules/homepage/homepage.slots.js';

const actor = { userId: 'a'.repeat(24), role: 'superAdmin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (identity.store && identity.store !== store || !roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: identity.userId };
} };
const png = () => sharp({ create: { width: 24, height: 16, channels: 3, background: 'white' } }).png().toBuffer();

test('homepage defaults are complete without writes and curation preserves order, live prices, hidden filtering and discount expiry', async () => {
  const f = homepageFixture(auth);
  for (const [store, count] of [['b2c', 6], ['b2b', 7]]) {
    const value = await f.homepage.getPublic(store, 'ar'), admin = await f.homepage.getStaff(store, actor);
    assert.equal(value.slots.length, count); assert.equal(admin.version, 0); assert.equal(value.updatedAt, null);
    assert.equal(Object.hasOwn(value, 'version'), false); assert.equal(Object.hasOwn(value, 'allowedSlots'), false);
    assert.ok(value.slots.every(slot => slot.desktopImage === null && slot.mobileImage === null && slot.alt === ''));
    assert.equal(Object.hasOwn(value, 'newArrivals'), store === 'b2c');
  }
  assert.equal(f.rows.size, 0);
  const category = await f.s.categories.create('b2c', actor, { slug: 'root', name: { en: 'Root', ar: 'رئيسي' } });
  const a = await f.products.create('b2c', actor, simpleInput(category.id));
  const b = await f.products.create('b2c', actor, { ...simpleInput(category.id, 'sale'), discountedPrice: 20000, stock: 0 });
  const v = await f.products.create('b2c', actor, variantInput(category.id));
  const sale = await f.s.sales.create('b2c', actor, saleInput(v.id));
  const saved = await f.homepage.update('b2c', actor, { version: 0,
    newArrivals: { productIds: [v.id, b.id, a.id] }, sale: { productIds: [a.id, b.id, v.id] } });
  assert.deepEqual(saved.newArrivals.visibleProductIds, [v.id, b.id, a.id]); assert.deepEqual(saved.sale.visibleProductIds, [b.id, v.id]);
  const publicValue = await f.homepage.getPublic('b2c', 'ar');
  assert.deepEqual(publicValue.newArrivals.items.map(item => item.id), [v.id, b.id, a.id]);
  assert.equal(publicValue.newArrivals.items[0].name, 'قميص'); assert.equal(publicValue.sale.items[0].stock, 0);
  assert.equal(publicValue.sale.items[1].variants[0].effectivePrice, 20000);
  assert.ok(publicValue.newArrivals.items.every(item => Object.hasOwn(item, 'sizeChart') && !Object.hasOwn(item, 'version')));
  f.s.at('2026-10-13T00:00:00Z');
  assert.deepEqual((await f.homepage.getPublic('b2c')).sale.items.map(item => item.id), [b.id]);
  await f.products.update('b2c', actor, b.id, { version: 0, isActive: false });
  assert.deepEqual((await f.homepage.getStaff('b2c', actor)).sale.visibleProductIds, []);
  await f.s.categories.update('b2c', actor, category.id, { isActive: false });
  assert.equal((await f.homepage.getPublic('b2c')).newArrivals.items.length, 0);
  assert.equal((await f.homepage.getStaff('b2b', actor)).version, 0);
  assert.equal(f.rows.size, 1); assert.ok(sale.id);
});

test('homepage uploads are store/slot/device bound and shared language images use partial alt with transactional cleanup', async () => {
  const f = homepageFixture(auth), buffer = await png();
  const desktop = await f.homepage.upload('b2c', actor, 'hero-left', 'desktop', buffer, 'image/png');
  assert.equal(f.rows.size, 0);
  for (const [store, key, device] of [['b2b', 'hero', 'desktop'], ['b2c', 'hero-right', 'desktop'], ['b2c', 'hero-left', 'mobile']]) {
    await assert.rejects(f.homepage.update(store, actor, { version: 0, slots: [{ key, [`${device}ImageId`]: desktop.id }] }), { code: 'MEDIA_CONFLICT' });
  }
  const saved = await f.homepage.update('b2c', actor, { version: 0, slots: [{ key: 'hero-left', desktopImageId: desktop.id, alt: { en: 'Cotton clothing', ar: 'ملابس قطنية' } }] });
  assert.equal(saved.slots[0].desktopImage.id, desktop.id); assert.equal(saved.slots[0].mobileImage, null);
  assert.equal((await f.homepage.getPublic('b2c', 'ar')).slots[0].alt, 'ملابس قطنية');
  const mobile = await f.homepage.upload('b2c', actor, 'hero-left', 'mobile', buffer, 'image/png');
  f.failAudit(true);
  await assert.rejects(f.homepage.update('b2c', actor, { version: 1, slots: [{ key: 'hero-left', desktopImageId: null, mobileImageId: mobile.id }] }), /audit failed/);
  assert.equal(f.m.rows.get(desktop.id).status, 'attached'); assert.equal(f.m.rows.get(mobile.id).status, 'ready');
  assert.equal(f.m.removals.length, 0); assert.equal(f.rows.get('b2c').version, 1);
  f.failAudit(false);
  await f.homepage.update('b2c', actor, { version: 1, slots: [{ key: 'hero-left', mobileImageId: mobile.id, alt: { ar: '' } }] });
  assert.equal((await f.homepage.getPublic('b2c', 'ar')).slots[0].alt, 'Cotton clothing');
  f.m.failRemove(true);
  await f.homepage.update('b2c', actor, { version: 2, slots: [{ key: 'hero-left', desktopImageId: null }] });
  assert.equal(f.m.rows.get(desktop.id).status, 'deletePending');
  f.m.failRemove(false); await f.media.cleanupTarget('b2c', 'homepage-desktop', homepageTargetId('b2c', 'hero-left'));
  assert.equal(f.m.rows.has(desktop.id), false);
  const expired = await f.homepage.upload('b2b', actor, 'hero', 'desktop', buffer, 'image/png'); f.m.advance(86400000);
  await assert.rejects(f.homepage.update('b2b', actor, { version: 0, slots: [{ key: 'hero', desktopImageId: expired.id }] }), { code: 'MEDIA_CONFLICT' });
  assert.equal(f.rows.has('b2b'), false);
});

test('strict homepage fields, fixed slots, roles, numeric bounds, races and Mongo/Bunny namespaces are enforced', async () => {
  const f = homepageFixture(auth);
  for (const input of [{ version: 0 }, { version: '0', slots: [] }, { version: 0, title: 'No CMS' },
    { version: 0, slots: [] }, { version: 0, slots: [{ key: 'unknown', alt: { en: 'x' } }] },
    { version: 0, slots: [{ key: 'hero-left' }] }, { version: 0, slots: [{ key: 'hero-left', alt: { fr: 'x' } }] },
    { version: 0, slots: [{ key: 'hero-left', alt: null }] }, { version: 0, slots: [{ key: 'hero-left', alt: { en: 'x'.repeat(501) } }] },
    { version: 0, slots: [{ key: 'hero-left', alt: { en: 'x' } }, { key: 'hero-left', alt: { ar: 'x' } }] },
    { version: 0, newArrivals: null }, { version: 0, newArrivals: { productIds: [null] } },
    { version: 0, newArrivals: { productIds: ['b'.repeat(24), 'B'.repeat(24)] } },
    { version: 0, newArrivals: { productIds: Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(24, '0')) } },
    { version: -1, sale: { productIds: [] } }, { version: 0, sale: { productIds: [], extra: true } }]) {
    await assert.rejects(f.homepage.update('b2c', actor, input), { code: 'VALIDATION_ERROR' }, JSON.stringify(input));
  }
  await assert.rejects(f.homepage.update('b2b', actor, { version: 0, sale: { productIds: [] } }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(f.homepage.update('b2c', actor, { version: 0, sale: { productIds: ['f'.repeat(24)] } }), { code: 'HOMEPAGE_PRODUCT_UNAVAILABLE' });
  for (const role of ['user', 'moderator']) await assert.rejects(f.homepage.getStaff('b2c', { ...actor, role }), { code: 'FORBIDDEN' });
  const attempts = await Promise.allSettled([1, 2].map(() => f.homepage.update('b2c', actor, { version: 0, sale: { productIds: [] } })));
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(row => row.status === 'rejected').reason.code, 'HOMEPAGE_CONFLICT');
  f.rows.get('b2c').version = Number.MAX_SAFE_INTEGER;
  await assert.rejects(f.homepage.update('b2c', actor, { version: Number.MAX_SAFE_INTEGER, sale: { productIds: [] } }), { code: 'HOMEPAGE_CONFLICT' });
  const query = homepageRepository.update('b2b', 3, { slots: [] }, {});
  assert.equal(query.getFilter()._id, 'b2b'); assert.equal(query.getFilter().version, 3); assert.equal(query.getUpdate().$inc.version, 1);
  const storage = createBunnyStorage({ zone: 'public', accessKey: 'synthetic', endpoint: 'https://storage.bunnycdn.com', cdnOrigin: 'https://assets.example.test' });
  for (const store of ['b2c', 'b2b']) for (const device of ['desktop', 'mobile']) for (const slot of homepageSlots(store)) {
    assert.match(storage.url(`narmer/${store}/catalog/homepage-${device}/${homepageTargetId(store, slot.key)}/${'b'.repeat(24)}.webp`), /https:/);
  }
  for (const kind of ['homepage', 'homepage-en', 'homepage-tablet', '../homepage-desktop']) {
    assert.throws(() => storage.url(`narmer/b2b/catalog/${kind}/${'a'.repeat(24)}/${'b'.repeat(24)}.webp`), { code: 'MEDIA_UNAVAILABLE' });
  }
});

test('homepage selections and Product deletion serialize under the catalog guard without dangling references', async () => {
  for (const assignmentFirst of [true, false]) {
    const f = homepageFixture(auth), category = await f.p.categories.create('b2c', actor, { slug: 'root', name: { en: 'Root', ar: 'رئيسي' } });
    const product = await f.products.create('b2c', actor, simpleInput(category.id));
    const assign = () => f.homepage.update('b2c', actor, { version: 0, newArrivals: { productIds: [product.id] } });
    const remove = () => f.products.remove('b2c', actor, product.id);
    const results = await Promise.allSettled(assignmentFirst ? [assign(), remove()] : [remove(), assign()]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.find(row => row.status === 'rejected').reason.code, assignmentFirst ? 'PRODUCT_REFERENCED' : 'HOMEPAGE_PRODUCT_UNAVAILABLE');
    if (assignmentFirst) {
      await f.homepage.update('b2c', actor, { version: 1, newArrivals: { productIds: [] } });
      await f.products.remove('b2c', actor, product.id); assert.equal(f.p.rows.size, 0);
    }
  }
});
