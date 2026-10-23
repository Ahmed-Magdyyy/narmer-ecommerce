import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AppError } from '../src/shared/errors/app-error.js';
import { wholesaleFixture, nativeInput, offerInput } from './helpers/wholesale.js';
import { simpleInput, variantInput } from './helpers/products.js';

const b2c = { store: 'b2c', userId: '1'.repeat(24), role: 'superAdmin' };
const b2b = { store: 'b2b', userId: '2'.repeat(24), role: 'superAdmin' };
const admin = { ...b2b, userId: '3'.repeat(24), role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (!identity || identity.store !== store) throw new AppError(401, 'UNAUTHORIZED');
  if (!roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: identity.userId, role: identity.role };
} };
async function setup() {
  const f = wholesaleFixture(auth);
  const category = await f.categories.create('b2c', b2c, { slug: 'wholesale-source', name: { ar: 'ملابس', en: 'Clothing' } });
  const simple = await f.products.create('b2c', b2c, { ...simpleInput(category.id), stock: 0 });
  const variant = await f.products.create('b2c', b2c, { ...variantInput(category.id), variants: variantInput(category.id).variants.map(row => ({ ...row, stock: 0 })) });
  return { f, category, simple, variant };
}
function noCommerceFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['price', 'stock', 'sku', 'effectivePrice', 'discountedPrice', 'currency', 'activeSale'].includes(key), key);
    noCommerceFields(child);
  }
}

test('Wholesale owns simple B2B-only products and publishes separate pouch sizes without commerce fields', async () => {
  const { f } = await setup();
  const native = await f.wholesale.createProduct('b2b', admin, nativeInput);
  assert.equal(native.type, 'simple');
  assert.equal(native.isActive, true);
  await assert.rejects(f.products.getPublic('b2c', native.id), { code: 'PRODUCT_NOT_FOUND' });
  const offer = await f.wholesale.createOffer('b2b', admin, offerInput('b2b', native.id));
  assert.equal(offer.isActive, false);
  assert.equal(offer.piecesPerPouch, 30);
  assert.equal((await f.wholesale.browse('b2b', {})).pagination.total, 0);
  const published = await f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, isActive: true });
  assert.equal(published.version, 1);
  const second = await f.wholesale.createOffer('b2b', admin, { ...offerInput('b2b', native.id, [{ quantity: 60 }]), isActive: true });
  assert.equal(second.piecesPerPouch, 60);
  const publicOffer = await f.wholesale.getPublic('b2b', offer.id, 'ar');
  assert.equal(publicOffer.name, 'عبوة الجملة');
  assert.equal(publicOffer.product.name, 'منتج الجملة');
  assert.equal(publicOffer.version, 1);
  noCommerceFields(publicOffer);
  await assert.rejects(f.wholesale.removeProduct('b2b', b2b, native.id), { code: 'WHOLESALE_REFERENCED' });
  await assert.rejects(f.wholesale.removeOffer('b2b', admin, offer.id), { code: 'FORBIDDEN' });
  await f.wholesale.removeOffer('b2b', b2b, offer.id);
  await f.wholesale.removeOffer('b2b', b2b, second.id);
  await f.wholesale.removeProduct('b2b', b2b, native.id);
});

test('Wholesale reuses zero-stock B2C products, mixed variants and protects even disabled references', async () => {
  const { f, variant } = await setup();
  const composition = variant.variants.map((row, i) => ({ variantId: row.id, quantity: i ? 20 : 10 }));
  const offer = await f.wholesale.createOffer('b2b', admin, { ...offerInput('b2c', variant.id, composition), isActive: true });
  assert.equal(offer.piecesPerPouch, 30);
  assert.equal(offer.isAvailable, true);
  noCommerceFields(offer);
  await assert.rejects(f.products.remove('b2c', b2c, variant.id), { code: 'PRODUCT_REFERENCED' });
  await assert.rejects(f.products.update('b2c', b2c, variant.id, { version: 0, variants: [variant.variants[0]] }), { code: 'PRODUCT_REFERENCED' });
  await f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, isActive: false });
  await assert.rejects(f.products.remove('b2c', b2c, variant.id), { code: 'PRODUCT_REFERENCED' });
  await f.wholesale.removeOffer('b2b', b2b, offer.id);
  await f.products.update('b2c', b2c, variant.id, { version: 0, variants: [variant.variants[0]] });
  await f.products.remove('b2c', b2c, variant.id);
});

test('Wholesale hides unpublished sources and permits retiring offers whose source became hidden', async () => {
  const { f, category, simple } = await setup();
  const offer = await f.wholesale.createOffer('b2b', admin, { ...offerInput('b2c', simple.id), isActive: true });
  await f.categories.update('b2c', b2c, category.id, { isActive: false });
  assert.equal((await f.wholesale.browse('b2b', {})).pagination.total, 0);
  await assert.rejects(f.wholesale.getPublic('b2b', offer.id), { code: 'WHOLESALE_OFFER_NOT_FOUND' });
  const staffView = await f.wholesale.getOffer('b2b', admin, offer.id);
  assert.equal(staffView.product, null);
  assert.equal(staffView.isAvailable, false);
  await f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, isActive: false });
  await assert.rejects(f.wholesale.updateOffer('b2b', admin, offer.id, { version: 1, isActive: true }), { code: 'WHOLESALE_SOURCE_UNAVAILABLE' });
  assert.equal((await f.wholesale.selectB2c('b2b', admin, {})).pagination.total, 0);
});

test('Wholesale validates composition, immutable sources and stale versions with rollback', async () => {
  const { f, simple, variant } = await setup();
  for (const composition of [[], [{ quantity: 0 }], [{ quantity: 1.5 }], [{ quantity: 10001 }], [{ quantity: 1 }, { quantity: 1 }],
    [{ variantId: variant.variants[0].id, quantity: 2 }], [{ quantity: 2, price: 1 }]]) {
    await assert.rejects(f.wholesale.createOffer('b2b', admin, offerInput('b2c', simple.id, composition)), { code: 'INVALID_WHOLESALE' });
  }
  await assert.rejects(f.wholesale.createOffer('b2b', admin, offerInput('b2c', variant.id)), { code: 'INVALID_WHOLESALE' });
  await assert.rejects(f.wholesale.createProduct('b2b', admin, { ...nativeInput, stock: 1 }), { code: 'INVALID_WHOLESALE' });
  const offer = await f.wholesale.createOffer('b2b', admin, offerInput('b2c', simple.id));
  await assert.rejects(f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, sourceStore: 'b2b' }), { code: 'WHOLESALE_SOURCE_IMMUTABLE' });
  const race = await Promise.allSettled([f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, isActive: true }),
    f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, name: { en: 'Other name' } })]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'WHOLESALE_CONFLICT');
  const before = await f.wholesale.getOffer('b2b', admin, offer.id);
  f.failWholesaleAudit(true);
  await assert.rejects(f.wholesale.updateOffer('b2b', admin, offer.id, { version: 1, isActive: false }), /wholesale audit failed/);
  assert.deepEqual(await f.wholesale.getOffer('b2b', admin, offer.id), before);
  await assert.rejects(f.wholesale.listOffers('b2c', admin, {}), { code: 'INVALID_STORE' });
});

test('Wholesale selector searches literal names and native Bunny images attach with rollback and retirement', async () => {
  const { f, simple } = await setup();
  assert.equal((await f.wholesale.selectB2c('b2b', admin, { q: 'Shirt', limit: 1 })).items.length, 1);
  assert.equal((await f.wholesale.selectB2c('b2b', admin, { q: '.*' })).pagination.total, 0);
  noCommerceFields(await f.wholesale.getB2c('b2b', admin, simple.id));
  const native = await f.wholesale.createProduct('b2b', admin, nativeInput);
  const buffer = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  const image = await f.media.upload('b2b', admin, 'product', native.id, buffer, 'image/png');
  assert.match(f.m.uploads[0].key, /narmer\/b2b\/catalog\/product\//);
  f.failWholesaleAudit(true);
  await assert.rejects(f.wholesale.updateProduct('b2b', admin, native.id, { version: 0, imageIds: [image.id] }), /wholesale audit failed/);
  assert.equal(f.m.rows.get(image.id).status, 'ready');
  f.failWholesaleAudit(false);
  const attached = await f.wholesale.updateProduct('b2b', admin, native.id, { version: 0, imageIds: [image.id] });
  assert.deepEqual(attached.images, [image]);
  assert.equal(f.m.rows.get(image.id).status, 'attached');
  await assert.rejects(f.media.upload('b2b', admin, 'category', native.id, buffer, 'image/png'), { code: 'INVALID_FIELD' });
  await f.wholesale.removeProduct('b2b', b2b, native.id);
  assert.equal(f.m.rows.size, 0);
  assert.equal(f.m.removals.length, 1);
});

test('Wholesale submission snapshots validate current selections, whole-pouch quantities and duplicate requests', async () => {
  const { f, simple } = await setup();
  const offer = await f.wholesale.createOffer('b2b', admin, { ...offerInput('b2c', simple.id), isActive: true });
  const request = { offerId: offer.id, version: 0, quantity: 2 };
  const snapshot = await f.transaction(session => f.wholesale.getForSubmission('b2b', [request], session));
  assert.equal(snapshot[0].quantity, 2);
  assert.equal(snapshot[0].piecesPerPouch, 30);
  noCommerceFields(snapshot);
  await assert.rejects(f.transaction(session => f.wholesale.getForSubmission('b2b', [request, request], session)), { code: 'INVALID_WHOLESALE' });
  await assert.rejects(f.transaction(session => f.wholesale.getForSubmission('b2b', [{ ...request, quantity: 1.5 }], session)), { code: 'INVALID_WHOLESALE' });
  await f.wholesale.updateOffer('b2b', admin, offer.id, { version: 0, composition: [{ quantity: 60 }] });
  assert.equal(snapshot[0].piecesPerPouch, 30);
  await assert.rejects(f.transaction(session => f.wholesale.getForSubmission('b2b', [request], session)), { code: 'WHOLESALE_CONFLICT' });
});
