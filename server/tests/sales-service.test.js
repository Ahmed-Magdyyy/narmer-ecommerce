import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/shared/errors/app-error.js';
import { productFixture, simpleInput, variantInput } from './helpers/products.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { Sale } from '../src/modules/sales/sales.model.js';
import { salesRepository } from '../src/modules/sales/sales.repository.js';

const owner = { _id: '1'.repeat(24), role: 'superAdmin' };
const admin = { _id: '2'.repeat(24), role: 'admin' };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== 'b2c' || !roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); return identity;
} };
async function fixture() {
  const p = productFixture(auth);
  const category = await p.categories.create('b2c', owner, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const product = await p.products.create('b2c', owner, simpleInput(category.id));
  return { ...salesFixture(auth, p), p, category, product };
}

test('Sales validates complete targets, percentages, schedules, defaults and partial translations', async () => {
  const f = await fixture();
  const input = saleInput(f.product.id);
  const row = await f.sales.create('b2c', admin, { ...input, name: { ar: ' تخفيضات ', en: ' Sale ' }, currency: 'USD', store: 'b2b' });
  assert.equal(row.status, 'active');
  assert.equal(row.isEnabled, true);
  assert.equal(row.currency, 'EGP');
  assert.equal(row.store, undefined);
  assert.equal(row.name.ar, 'تخفيضات');
  assert.equal(row.categoryId, null);
  const updated = await f.sales.update('b2c', admin, row.id, { name: { en: 'Summer sale' } });
  assert.equal(updated.name.ar, row.name.ar);
  assert.equal(updated.name.en, 'Summer sale');
  for (const fields of [{ productIds: [] }, { productIds: [f.product.id, f.product.id] }, { categoryId: f.category.id },
    { discountValue: 0 }, { discountValue: 101 }, { discountValue: 2.5 }, { discountValue: '20' }, { discountValue: null },
    { startsAt: '2026-10-11T12:00:00' }, { endsAt: input.startsAt }, { endsAt: '2026-10-10T00:00:00Z' }, { isEnabled: 'true' }]) {
    await assert.rejects(f.sales.create('b2c', owner, { ...input, ...fields }), { code: 'INVALID_SALE' });
  }
  await assert.rejects(f.sales.update('b2c', admin, row.id, {}), { code: 'INVALID_SALE' });
  await assert.rejects(f.sales.create('b2c', owner, { ...input, productIds: ['f'.repeat(24)] }), { code: 'SALE_TARGET_NOT_FOUND' });
  const categorySale = await f.sales.update('b2c', admin, row.id, { targetType: 'category', categoryId: f.category.id,
    discountType: 'fixed', discountValue: 1000 });
  assert.deepEqual(categorySale.productIds, []);
  assert.equal(categorySale.categoryId, f.category.id);
  await assert.rejects(f.sales.update('b2c', owner, row.id, { targetType: 'products' }), { code: 'INVALID_SALE' });
});

test('Sales rejects overlapping scopes, including empty descendant categories, and allows adjacent schedules and disabled drafts', async () => {
  const f = await fixture();
  const child = await f.categories.create('b2c', owner, { name: { ar: 'فرع', en: 'Child' }, slug: 'child', parentId: f.category.id });
  const first = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), targetType: 'category', productIds: [], categoryId: f.category.id });
  await assert.rejects(f.sales.create('b2c', owner, saleInput(f.product.id)), { code: 'SALE_OVERLAP' });
  await assert.rejects(f.sales.create('b2c', owner, { ...saleInput(f.product.id), targetType: 'category', productIds: [], categoryId: child.id }), { code: 'SALE_OVERLAP' });
  const draft = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), isEnabled: false });
  await assert.rejects(f.sales.update('b2c', owner, draft.id, { isEnabled: true }), { code: 'SALE_OVERLAP' });
  const adjacent = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), startsAt: first.endsAt, endsAt: '2026-10-13T12:00:00Z' });
  assert.equal(adjacent.status, 'scheduled');
  await assert.rejects(f.sales.update('b2c', owner, first.id, { endsAt: '2026-10-13T12:00:00Z' }), { code: 'SALE_OVERLAP' });
  assert.equal((await f.sales.getStaff('b2c', owner, first.id)).endsAt, first.endsAt);
});

test('Campaign prices replace saved discounts, round in piastres, cover all variants and descendants, and restore current saved prices', async () => {
  const f = await fixture();
  const child = await f.categories.create('b2c', owner, { name: { ar: 'فرع', en: 'Child' }, slug: 'child', parentId: f.category.id });
  const variants = await f.products.create('b2c', owner, variantInput(child.id));
  await f.products.update('b2c', owner, f.product.id, { version: 0, price: 101, discountedPrice: 10 });
  const sale = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), targetType: 'category', productIds: [], categoryId: f.category.id });
  let product = await f.products.getPublic('b2c', f.product.id, 'en');
  assert.equal(product.price, 101); assert.equal(product.discountedPrice, 81); assert.equal(product.effectivePrice, 81);
  assert.equal(product.activeSale.id, sale.id); assert.equal(product.activeSale.name, 'Sale');
  assert.equal((await f.products.getPublic('b2c', f.product.id, 'ar')).activeSale.name, 'تخفيضات');
  const dashboard = await f.products.getStaff('b2c', owner, f.product.id);
  assert.equal(dashboard.discountedPrice, 10); assert.equal(dashboard.activeSale, undefined);
  const publicVariants = await f.products.getPublic('b2c', variants.id, 'en');
  assert.equal(publicVariants.priceFrom, 20000);
  assert.deepEqual(publicVariants.variants.map(row => row.effectivePrice), [20000, 24000]);
  assert.ok(publicVariants.variants.every(row => row.activeSale.id === sale.id));
  assert.equal(publicVariants.activeSale, undefined);
  assert.equal((await f.products.browse('b2c', {}, 'en')).items.find(row => row.id === f.product.id).effectivePrice, 81);
  assert.equal((await f.products.getForCart('b2c', [f.product.id]))[0].effectivePrice, 81);
  await f.products.update('b2c', owner, f.product.id, { version: 1, price: 200, discountedPrice: 50 });
  await f.sales.update('b2c', owner, sale.id, { discountType: 'fixed', discountValue: 50000 });
  product = await f.products.getPublic('b2c', f.product.id, 'en');
  assert.equal(product.effectivePrice, 0); assert.ok(product.activeSale);
  await f.sales.update('b2c', owner, sale.id, { isEnabled: false });
  product = await f.products.getPublic('b2c', f.product.id, 'en');
  assert.equal(product.effectivePrice, 50); assert.equal(product.activeSale, null);
  await f.sales.update('b2c', owner, sale.id, { isEnabled: true, discountType: 'percentage', discountValue: 100 });
  assert.equal((await f.products.getPublic('b2c', f.product.id, 'en')).effectivePrice, 0);
  f.at(sale.endsAt);
  assert.equal((await f.products.getPublic('b2c', f.product.id, 'en')).effectivePrice, 50);
  assert.equal(f.p.rows.get(f.product.id).discountedPrice, 50);
  f.at(sale.startsAt);
  await f.sales.update('b2c', owner, sale.id, { discountValue: 20 });
  await f.products.update('b2c', owner, f.product.id, { version: 2, price: 1, discountedPrice: null });
  const tiny = await f.products.getPublic('b2c', f.product.id, 'en');
  assert.equal(tiny.effectivePrice, 1);
  assert.equal(tiny.activeSale.id, sale.id);
});

test('Catalog moves cannot introduce overlap and every saved sale blocks target deletion, including disabled/expired sales', async () => {
  const f = await fixture();
  const other = await f.categories.create('b2c', owner, { name: { ar: 'آخر', en: 'Other' }, slug: 'other' });
  const empty = await f.categories.create('b2c', owner, { name: { ar: 'فارغ', en: 'Empty' }, slug: 'empty', parentId: other.id });
  const productSale = await f.sales.create('b2c', owner, saleInput(f.product.id));
  const categorySale = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), targetType: 'category', productIds: [], categoryId: other.id });
  await assert.rejects(f.products.update('b2c', owner, f.product.id, { version: 0, categoryId: other.id }), { code: 'SALE_OVERLAP' });
  await assert.rejects(f.categories.update('b2c', owner, f.category.id, { parentId: other.id }), { code: 'SALE_OVERLAP' });
  assert.equal((await f.products.getStaff('b2c', owner, f.product.id)).categoryId, f.category.id);
  await f.sales.update('b2c', owner, productSale.id, { isEnabled: false });
  await assert.rejects(f.products.remove('b2c', owner, f.product.id), { code: 'PRODUCT_REFERENCED' });
  const emptySale = await f.sales.create('b2c', owner, { ...saleInput(f.product.id), targetType: 'category', productIds: [], categoryId: empty.id, isEnabled: false });
  await assert.rejects(f.categories.remove('b2c', owner, empty.id), { code: 'CATEGORY_HAS_SALES' });
  await f.sales.remove('b2c', owner, emptySale.id);
  await f.categories.remove('b2c', owner, empty.id);
  await f.sales.remove('b2c', owner, categorySale.id);
  await f.products.update('b2c', owner, f.product.id, { version: 0, categoryId: other.id });
  f.at('2026-10-13T00:00:00Z');
  await assert.rejects(f.products.remove('b2c', owner, f.product.id), { code: 'PRODUCT_REFERENCED' });
  await f.sales.remove('b2c', owner, productSale.id);
  await f.products.remove('b2c', owner, f.product.id);
});

test('Competing sales serialize through the catalog transaction guard', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.sales.create('b2c', owner, saleInput(f.product.id)), f.sales.create('b2c', admin, saleInput(f.product.id))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'SALE_OVERLAP');
  assert.equal(f.rows.size, 1); assert.equal(f.audits.length, 1);
});

test('Sales state uses inclusive start, exclusive end and explicit disable without a scheduler', async () => {
  const f = await fixture();
  const row = await f.sales.create('b2c', owner, saleInput(f.product.id));
  f.at('2026-10-11T11:59:59.999Z');
  assert.equal((await f.sales.getStaff('b2c', admin, row.id)).status, 'scheduled');
  f.at('2026-10-11T12:00:00Z');
  assert.equal((await f.sales.getStaff('b2c', admin, row.id)).status, 'active');
  f.at('2026-10-12T12:00:00Z');
  assert.equal((await f.sales.getStaff('b2c', admin, row.id)).status, 'expired');
  assert.equal((await f.sales.update('b2c', admin, row.id, { isEnabled: false })).status, 'disabled');
  assert.equal((await f.sales.list('b2c', admin, { isEnabled: true })).items.length, 0);
  assert.equal((await f.sales.list('b2c', admin, { isEnabled: false })).pagination.total, 1);
});

test('Sales isolates B2C and staff permissions; admin cannot delete, and failed audits roll back', async () => {
  const f = await fixture();
  const row = await f.sales.create('b2c', admin, saleInput(f.product.id));
  for (const role of ['moderator', 'user']) {
    await assert.rejects(f.sales.list('b2c', { ...admin, role }), { code: 'FORBIDDEN' });
    await assert.rejects(f.sales.create('b2c', { ...admin, role }, saleInput(f.product.id)), { code: 'FORBIDDEN' });
  }
  await assert.rejects(f.sales.remove('b2c', admin, row.id), { code: 'FORBIDDEN' });
  await assert.rejects(f.sales.list('b2b', owner), { code: 'INVALID_STORE' });
  await assert.rejects(f.sales.getStaff('b2c', owner, 'f'.repeat(24)), { code: 'SALE_NOT_FOUND' });
  f.failAudit(true);
  await assert.rejects(f.sales.create('b2c', owner, { ...saleInput(f.product.id), isEnabled: false }), /audit failed/);
  await assert.rejects(f.sales.update('b2c', owner, row.id, { discountValue: 50 }), /audit failed/);
  await assert.rejects(f.sales.remove('b2c', owner, row.id), /audit failed/);
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get(row.id).discountValue, 20);
  assert.equal(f.audits.length, 1);
  f.failAudit(false);
  await f.sales.remove('b2c', owner, row.id);
  assert.equal(f.rows.size, 0);
});

test('Sales repository uses scoped filters and transaction sessions; schema indexes target lookups', () => {
  assert.ok(Sale.schema.indexes().some(([keys]) => keys.store === 1 && keys.productIds === 1));
  assert.ok(Sale.schema.indexes().some(([keys]) => keys.store === 1 && keys.categoryId === 1));
  const session = { marker: true }, saleId = '3'.repeat(24);
  const lookup = salesRepository.findById('b2c', saleId, session);
  assert.deepEqual(lookup.getFilter(), { store: 'b2c', _id: saleId });
  assert.deepEqual(lookup.getOptions().session, session);
  const update = salesRepository.update('b2c', saleId, { isEnabled: false }, session);
  assert.deepEqual(update.getFilter(), { store: 'b2c', _id: saleId });
  assert.deepEqual(update.getOptions().session, session);
});
