import test from 'node:test';
import assert from 'node:assert/strict';
import { productFixture, simpleInput } from './helpers/products.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { productsRepository } from '../src/modules/products/products.repository.js';

const identity = { userId: 'a'.repeat(24), role: 'superAdmin' };
const auth = { async authorizeStaff(store, actor, roles) {
  if (!roles.includes(actor.role)) throw new AppError(403, 'FORBIDDEN');
  return { _id: actor.userId };
} };
async function setup() {
  const f = productFixture(auth), s = salesFixture(auth, f);
  const root = await f.categories.create('b2c', identity, { slug: 'root', name: { en: 'Clothing', ar: 'ملابس' } });
  const options = ['size', 'color'].map(key => ({ key, name: { en: key, ar: key },
    values: (key === 'size' ? ['small', 'large'] : ['red', 'blue']).map(value => ({ key: value, name: { en: value, ar: `ع-${value}` } })) }));
  const variant = await f.products.create('b2c', identity, { type: 'variant', categoryId: root.id, slug: 'variants',
    name: { en: 'Shirt', ar: 'قميص' }, options, variants: [
      { values: { size: 'small', color: 'red' }, price: 20000, stock: 0 },
      { values: { size: 'large', color: 'blue' }, price: 30000, stock: 5 },
      { values: { size: 'large', color: 'red' }, price: 40000, discountedPrice: 25000, stock: 5 },
    ] });
  const simple = await f.products.create('b2c', identity, { ...simpleInput(root.id), price: 28000, stock: 0 });
  return { ...f, ...s, repository: f.repository, rows: f.rows, root, variant, simple };
}

test('browse matches one real variant, sorts effective prices before count/pagination and keeps zero stock', async () => {
  const f = await setup();
  const impossible = await f.products.browse('b2c', { size: 'small', color: 'blue' }, 'en');
  assert.deepEqual(impossible.items, []); assert.equal(impossible.pagination.total, 0);
  const filtered = await f.products.browse('b2c', { size: 'large', color: 'blue', maxPrice: 25000 }, 'en');
  assert.equal(filtered.pagination.total, 0);
  const large = await f.products.browse('b2c', { size: 'large', sort: 'price-asc' }, 'en');
  assert.equal(large.items[0].matchingVariantId, f.variant.variants[2].id);
  assert.equal(large.items[0].matchingPrice, 25000); assert.equal(large.items[0].priceFrom, 20000);
  const page = await f.products.browse('b2c', { sort: 'price-desc', limit: 1 }, 'en');
  assert.equal(page.items[0].id, f.simple.id); assert.equal(page.pagination.total, 2); assert.equal(page.pagination.pages, 2);
  assert.equal(page.items[0].stock, 0); assert.equal(page.items[0].matchingVariantId, null);
  assert.equal((await f.products.browse('b2c', { sort: 'price-desc', limit: 1, page: 2 }, 'en')).items[0].id, f.variant.id);
  assert.equal((await f.products.browse('b2c', { minPrice: 20000, maxPrice: 20000 }, 'en')).items[0].variants[0].stock, 0);
  assert.equal((await f.products.browse('b2c', { page: 10 }, 'en')).items.length, 0);
});

test('sale browsing uses saved discounts or active campaigns at one clock instant without changing coupon rules', async () => {
  const f = await setup();
  assert.deepEqual((await f.products.browse('b2c', { saleOnly: true }, 'en')).items.map(item => item.id), [f.variant.id]);
  const campaign = await f.sales.create('b2c', identity, { ...saleInput(f.simple.id), discountType: 'fixed', discountValue: 50000 });
  const sale = await f.products.browse('b2c', { saleOnly: true, sort: 'price-asc', limit: 1 }, 'en');
  assert.equal(sale.pagination.total, 2); assert.equal(sale.items[0].matchingPrice, 0);
  assert.equal(sale.items[0].activeSale.id, campaign.id);
  f.at('2026-10-12T12:00:00Z');
  assert.deepEqual((await f.products.browse('b2c', { saleOnly: true }, 'en')).items.map(item => item.id), [f.variant.id]);
  const noFilters = await f.products.browse('b2c', {}, 'en');
  assert.equal(noFilters.items.find(item => item.id === f.simple.id).effectivePrice, 28000);
});

test('facets count distinct products, ignore their own filter, preserve zero choices, and localize labels', async () => {
  const f = await setup();
  const facets = await f.products.facets('b2c', { size: 'large', color: 'red', minPrice: 24000, maxPrice: 26000 }, 'ar');
  assert.equal(facets.pricedAt, '2026-10-11T12:00:00.000Z');
  assert.deepEqual(facets.price, { min: 25000, max: 25000 });
  assert.deepEqual(facets.sizes, [{ key: 'large', name: 'ع-large', count: 1 }, { key: 'small', name: 'ع-small', count: 0 }]);
  assert.deepEqual(facets.colors, [{ key: 'blue', name: 'ع-blue', count: 0 }, { key: 'red', name: 'ع-red', count: 1 }]);
  assert.equal((await f.products.facets('b2c', { color: 'red' }, 'en')).colors.find(item => item.key === 'red').count, 1);
  const unknown = await f.products.facets('b2c', { size: 'unknown', color: 'unknown' }, 'en');
  assert.deepEqual(unknown.price, { min: null, max: null }); assert.equal(unknown.applied.size, 'unknown');
  assert.ok(unknown.sizes.every(item => item.count === 0));
  assert.equal(unknown.sizes.some(item => item.key === 'unknown'), false);
});

test('public selection preserves category descendants/visibility and never leaks dashboard pricing fields', async () => {
  const f = await setup();
  const child = await f.categories.create('b2c', identity, { slug: 'child', parentId: f.root.id, name: { en: 'Child', ar: 'فرع' } });
  const third = await f.products.create('b2c', identity, simpleInput(child.id, 'child-shirt'));
  assert.equal((await f.products.browse('b2c', { categoryId: f.root.id }, 'en')).pagination.total, 3);
  const dto = (await f.products.browse('b2c', { categoryId: child.id }, 'en')).items[0];
  assert.equal(dto.id, third.id); assert.equal(Object.hasOwn(dto, 'version'), false); assert.equal(Object.hasOwn(dto, '_id'), false);
  await f.categories.update('b2c', identity, f.root.id, { isActive: false });
  assert.equal((await f.products.browse('b2c', {}, 'en')).pagination.total, 0);
  assert.deepEqual((await f.products.facets('b2c', {}, 'en')).price, { min: null, max: null });
  await assert.rejects(f.products.facets('b2c', { categoryId: child.id }, 'en'), { code: 'CATEGORY_NOT_FOUND' });
  const query = productsRepository.browseCandidates('b2c', { categoryIds: [f.root.id], type: 'simple' });
  assert.equal(query.getFilter().isActive, true); assert.equal(query.getFilter().store, 'b2c');
  assert.equal(query.projection().images, undefined); assert.equal(query.projection().description, undefined);
});

test('browse does not mix a filtered pricing revision with a concurrently changed product revision', async () => {
  const f = await setup();
  const find = f.repository.findByIds;
  f.repository.findByIds = async (...args) => {
    f.rows.get(f.variant.id).version++;
    f.rows.get(f.variant.id).variants[0].values.color = 'blue';
    return find(...args);
  };
  const result = await f.products.browse('b2c', { size: 'small', color: 'red' }, 'en');
  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.total, 1);
});
