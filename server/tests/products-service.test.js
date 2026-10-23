import test from 'node:test';
import assert from 'node:assert/strict';
import { productFixture, simpleInput, variantInput } from './helpers/products.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { Product } from '../src/modules/products/products.model.js';
import { productsRepository } from '../src/modules/products/products.repository.js';

const owner = { userId: 'a'.repeat(24), role: 'superAdmin' };
const admin = { ...owner, role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (!roles.includes(identity.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: identity.userId };
} };
async function fixture() {
  const f = productFixture(auth);
  const root = await f.categories.create('b2c', admin, { slug: 'root', name: { ar: 'ملابس', en: 'Clothing' } });
  return { ...f, root };
}

test('order stock changes deduct exact variants, advance versions, reject overselling and restore atomically', async () => {
  const f = await fixture();
  const simple = await f.products.create('b2c', admin, simpleInput(f.root.id));
  const variant = await f.products.create('b2c', admin, variantInput(f.root.id));
  const items = [{ productId: simple.id, variantId: null, quantity: 2 },
    { productId: variant.id, variantId: variant.variants[0].id, quantity: 3 }];
  await assert.rejects(f.products.adjustOrderStock('b2c', items, {}), /transaction session/);
  await f.transaction(session => f.products.adjustOrderStock('b2c', items, { session }));
  assert.equal(f.rows.get(simple.id).stock, 8); assert.equal(f.rows.get(simple.id).version, 1);
  assert.deepEqual(f.rows.get(variant.id).variants.map(v => v.stock), [2, 2]);
  await assert.rejects(f.transaction(session => f.products.adjustOrderStock('b2c', items, { session })), { code: 'ORDER_STOCK_UNAVAILABLE' });
  assert.equal(f.rows.get(simple.id).stock, 8);
  await f.transaction(session => f.products.adjustOrderStock('b2c', items, { session, restore: true }));
  assert.equal(f.rows.get(simple.id).stock, 10); assert.equal(f.rows.get(variant.id).variants[0].stock, 5);
  f.rows.get(simple.id).stock = 1000000000;
  await assert.rejects(f.transaction(session => f.products.adjustOrderStock('b2c', items, { session, restore: true })), { code: 'ORDER_STOCK_RESTORE_FAILED' });
  const query = productsRepository.adjustStock('b2c', variant.id, variant.variants[0].id, 3, false, { marker: true });
  assert.deepEqual(query.getFilter().variants.$elemMatch.stock, { $gte: 3 });
  assert.equal(query.getUpdate().$inc['variants.$.stock'], -3); assert.equal(query.getUpdate().$inc.version, 1);
});

test('simple prices use exact EGP minor units, optional normalized SKUs, safe DTOs and partial translations', async () => {
  const f = await fixture();
  const first = await f.products.create('b2c', admin, { ...simpleInput(f.root.id), sku: ' abc-1 ', discountedPrice: 20000,
    store: 'b2b', currency: 'USD', skuKeys: ['evil'], image: 'unsafe' });
  assert.equal(first.sku, 'ABC-1');
  assert.equal(first.currency, 'EGP');
  assert.equal(first.effectivePrice, 20000);
  assert.equal(Object.hasOwn(first, 'skuKeys'), false);
  await f.products.create('b2c', admin, simpleInput(f.root.id, 'no-sku-1'));
  await f.products.create('b2c', admin, simpleInput(f.root.id, 'no-sku-2'));
  const changed = await f.products.update('b2c', admin, first.id, { version: first.version,
    name: { ar: 'قميص جديد' }, discountedPrice: null, sku: '' });
  assert.equal(changed.name.en, 'Shirt');
  assert.equal(changed.effectivePrice, 25000);
  assert.equal(changed.sku, null);
  const publicItem = await f.products.getPublic('b2c', first.id, 'ar');
  assert.equal(publicItem.name, 'قميص جديد');
  assert.equal(Object.hasOwn(publicItem, 'version'), false);
  await assert.rejects(f.products.update('b2c', admin, first.id, { version: changed.version, type: 'variant' }), { code: 'PRODUCT_TYPE_IMMUTABLE' });
  for (const fields of [{ price: 10.5 }, { price: '25000' }, { stock: -1 }, { discountedPrice: 30000 }]) {
    await assert.rejects(f.products.create('b2c', admin, { ...simpleInput(f.root.id, 'bad'), ...fields }), { code: 'INVALID_PRODUCT' });
  }
});

test('variants validate choices/combinations, share the SKU namespace, and keep stable IDs and independent stock', async () => {
  const f = await fixture();
  await f.products.create('b2c', admin, { ...simpleInput(f.root.id), sku: 'SHARED' });
  const input = variantInput(f.root.id);
  const duplicate = structuredClone(input);
  duplicate.variants[0].sku = 'shared';
  await assert.rejects(f.products.create('b2c', admin, duplicate), { code: 'PRODUCT_SKU_EXISTS' });
  input.variants[0].sku = 'small-1';
  const created = await f.products.create('b2c', admin, input);
  assert.equal(Object.hasOwn(created, 'stock'), false);
  assert.equal(created.variants[0].stock, 5);
  assert.equal(created.priceFrom, 25000);
  const renamed = await f.products.update('b2c', admin, created.id, { version: 0, name: { en: 'New name' } });
  assert.equal(renamed.variants[0].id, created.variants[0].id);
  const edited = await f.products.update('b2c', admin, created.id, { version: 1,
    variants: created.variants.map(item => ({ id: item.id, price: item.price + 100, values: item.values })) });
  assert.equal(edited.variants[0].stock, 5);
  assert.equal(edited.variants[0].sku, 'SMALL-1');
  assert.equal(edited.variants[0].id, created.variants[0].id);
  for (const modify of [
    data => { data.variants[0].values.size = 'unknown'; },
    data => { data.variants[1].values = { size: 'small' }; },
    data => { data.variants[0].values.extra = 'bad'; },
    data => { data.variants[0].id = 'f'.repeat(24); },
    data => { data.options[0].key = 'constructor'; },
    data => { data.stock = 999; },
  ]) {
    const invalid = structuredClone(variantInput(f.root.id, 'invalid'));
    modify(invalid);
    await assert.rejects(f.products.create('b2c', admin, invalid), { code: 'INVALID_PRODUCT' });
  }
});

test('category assignments include inactive products in deletion blockers and hide products under inactive ancestors', async () => {
  const f = await fixture();
  const child = await f.categories.create('b2c', admin, { name: { ar: 'فرعي', en: 'Child' }, slug: 'child', parentId: f.root.id });
  const product = await f.products.create('b2c', admin, simpleInput(child.id));
  assert.equal((await f.products.browse('b2c', { categoryId: f.root.id }, 'en')).pagination.total, 1);
  await f.categories.update('b2c', admin, f.root.id, { isActive: false });
  assert.equal((await f.products.browse('b2c', {}, 'en')).pagination.total, 0);
  await assert.rejects(f.products.getPublic('b2c', product.id, 'en'), { code: 'PRODUCT_NOT_FOUND' });
  await f.products.update('b2c', admin, product.id, { version: 0, isActive: false });
  await assert.rejects(f.categories.remove('b2c', owner, child.id), { code: 'CATEGORY_HAS_PRODUCTS' });
  await assert.rejects(f.products.update('b2c', admin, product.id, { version: 1, categoryId: 'f'.repeat(24) }), { code: 'CATEGORY_PARENT_NOT_FOUND' });
  assert.equal((await f.products.list('b2c', admin, {})).pagination.total, 1);
});

test('version conflicts and audit failures preserve stored data; delete and variant removal honor reference guards', async () => {
  const f = await fixture();
  const product = await f.products.create('b2c', admin, simpleInput(f.root.id));
  const edits = await Promise.allSettled([
    f.products.update('b2c', admin, product.id, { version: 0, stock: 1 }),
    f.products.update('b2c', admin, product.id, { version: 0, stock: 2 }),
  ]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(edits.find(result => result.status === 'rejected').reason.code, 'PRODUCT_CONFLICT');
  f.failAudit(true);
  await assert.rejects(f.products.update('b2c', admin, product.id, { version: 1, stock: 100 }), /audit failed/);
  assert.equal(f.rows.get(product.id).stock, 1);
  f.failAudit(false);
  f.references.add(product.id);
  await assert.rejects(f.products.remove('b2c', owner, product.id), { code: 'PRODUCT_REFERENCED' });
  f.references.clear();
  const variants = await f.products.create('b2c', admin, variantInput(f.root.id));
  f.references.add(variants.variants[1].id);
  await assert.rejects(f.products.update('b2c', admin, variants.id, { version: 0,
    variants: [variants.variants[0]] }), { code: 'PRODUCT_REFERENCED' });
  f.references.clear();
  await assert.rejects(f.products.remove('b2c', admin, product.id), { code: 'FORBIDDEN' });
  await f.products.remove('b2c', owner, product.id);
  assert.equal(f.rows.has(product.id), false);
  for (const role of ['moderator', 'user']) await assert.rejects(f.products.create('b2c', { ...admin, role }, simpleInput(f.root.id)), { code: 'FORBIDDEN' });
  await assert.rejects(f.products.create('b2b', owner, simpleInput(f.root.id)), { code: 'INVALID_STORE' });
});

test('Mongo product indexes and queries enforce the shared optional SKU namespace and versioned writes', () => {
  const skuIndex = Product.schema.indexes().find(([keys]) => keys.skuKeys === 1);
  assert.equal(skuIndex[1].unique, true);
  assert.deepEqual(skuIndex[1].partialFilterExpression, { 'skuKeys.0': { $exists: true } });
  const session = { marker: true };
  const query = productsRepository.update('b2c', owner.userId, 3, { stock: 1 }, session);
  assert.deepEqual(query.getFilter(), { store: 'b2c', _id: owner.userId, version: 3 });
  assert.equal(query.getUpdate().$inc.version, 1);
  assert.deepEqual(query.getOptions().session, session);
});
