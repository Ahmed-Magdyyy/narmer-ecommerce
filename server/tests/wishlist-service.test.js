import test from 'node:test';
import assert from 'node:assert/strict';
import { identityFixture } from './helpers/identity.js';
import { wishlistFixture } from './helpers/wishlist.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { createWishlistService } from '../src/modules/wishlist/wishlist.service.js';

async function setup() {
  const f = identityFixture();
  const p = wishlistFixture(f.auth);
  const { input } = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const staff = await f.auth.authenticate('b2c', (await f.auth.login('b2c', input.email, input.password)).accessToken);
  await f.auth.register('b2c', { ...input, email: 'wishlist-customer@example.com' }, 'en');
  await f.auth.verifyEmail('b2c', 'wishlist-customer@example.com', f.emails.at(-1).code);
  const customer = await f.auth.authenticate('b2c', (await f.auth.login('b2c', 'wishlist-customer@example.com', input.password)).accessToken);
  const category = await p.categories.create('b2c', staff, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const simple = await p.products.create('b2c', staff, simpleInput(category.id));
  const variant = await p.products.create('b2c', staff, variantInput(category.id));
  return { f, p, customer, staff, category, simple, variant };
}

test('wishlist keeps one product entry across repeated/concurrent adds and reads current bilingual prices', async () => {
  const { p, customer, staff, simple, variant } = await setup();
  assert.deepEqual(await p.wishlist.get('b2c', customer), { items: [], itemCount: 0 });
  assert.equal(p.wishlistRows.size, 0);
  await Promise.all([p.wishlist.add('b2c', customer, simple.id.toUpperCase()), p.wishlist.add('b2c', customer, simple.id)]);
  const added = await p.wishlist.add('b2c', customer, variant.id, 'ar');
  assert.equal(added.itemCount, 2);
  assert.equal(added.items[0].product.name, 'قميص');
  assert.equal(added.items[1].product.variants.length, 2);
  assert.ok(!Object.hasOwn(added.items[1], 'variantId'));
  await p.products.update('b2c', staff, simple.id, { version: 0, discountedPrice: 20000, stock: 0 });
  const current = await p.wishlist.get('b2c', customer, 'en');
  assert.equal(current.items[0].product.effectivePrice, 20000);
  assert.equal(current.items[0].product.stock, 0);
  assert.equal(current.items[0].status, 'available');
  assert.equal(p.wishlistRows.size, 1);
  assert.deepEqual((await p.wishlist.remove('b2c', customer, simple.id)).items.map(item => item.productId), [variant.id]);
  assert.equal((await p.wishlist.remove('b2c', customer, simple.id)).itemCount, 1);
  assert.deepEqual(await p.wishlist.clear('b2c', customer), { items: [], itemCount: 0 });
  assert.deepEqual(await p.wishlist.clear('b2c', customer), { items: [], itemCount: 0 });
});

test('hidden products expose no catalog data and saved references block deletion but not variant removal', async () => {
  const { p, customer, staff, simple, variant, category } = await setup();
  await p.wishlist.add('b2c', customer, simple.id);
  await p.wishlist.add('b2c', customer, variant.id);
  await assert.rejects(p.products.remove('b2c', staff, simple.id), { code: 'PRODUCT_REFERENCED' });
  await p.products.update('b2c', staff, variant.id, { version: 0, variants: [variant.variants[0]] });
  await p.categories.update('b2c', staff, category.id, { isActive: false });
  const hidden = await p.wishlist.get('b2c', customer);
  assert.ok(hidden.items.every(item => item.product === null && item.status === 'unavailable'));
  await assert.rejects(p.wishlist.add('b2c', customer, simple.id), { code: 'PRODUCT_NOT_FOUND' });
  assert.equal((await p.wishlist.remove('b2c', customer, simple.id)).itemCount, 1);
  await p.products.remove('b2c', staff, simple.id);
  await p.wishlist.clear('b2c', customer);
  await p.products.remove('b2c', staff, variant.id);
});

test('wishlist rejects unauthorized callers and invalid identifiers and isolates customer ownership', async () => {
  const { f, p, customer, staff, simple } = await setup();
  await assert.rejects(p.wishlist.get('b2b', customer), { code: 'INVALID_STORE' });
  await assert.rejects(p.wishlist.get('b2c', staff), { code: 'FORBIDDEN' });
  await assert.rejects(p.wishlist.add('b2c', customer, 'invalid'), { code: 'VALIDATION_ERROR' });
  await assert.rejects(p.wishlist.add('b2c', customer, 'a'.repeat(24)), { code: 'PRODUCT_NOT_FOUND' });
  await p.wishlist.add('b2c', customer, simple.id);
  f.accounts.get(customer.userId).status = 'blocked';
  await assert.rejects(p.wishlist.get('b2c', customer), { code: 'UNAUTHORIZED' });
});

test('wishlist limit preserves repeated adds and failures roll back writes and catalogue guard', async () => {
  const { p, customer, simple, variant } = await setup();
  const placeholders = Array.from({ length: 99 }, (_, i) => i.toString(16).padStart(24, '0'));
  p.wishlistRows.set(`b2c:${customer.userId}`, { store: 'b2c', userId: customer.userId, productIds: [...placeholders, simple.id] });
  assert.equal((await p.wishlist.add('b2c', customer, simple.id)).itemCount, 100);
  await assert.rejects(p.wishlist.add('b2c', customer, variant.id), { code: 'WISHLIST_LIMIT_EXCEEDED' });
  await p.wishlist.clear('b2c', customer);
  p.failWrite(true);
  await assert.rejects(p.wishlist.add('b2c', customer, simple.id), /wishlist write failed/);
  assert.equal(p.wishlistRows.size, 0);
  p.failWrite(false);
  const failing = createWishlistService({ auth: { authorizeStaff: async () => ({ _id: customer.userId }) },
    products: { ...p.products, async getForCart(...args) {
      if (args[1].length === 1 && p.wishlistRows.size) throw new Error('presentation failed');
      return p.products.getForCart(...args);
    } }, repository: p.wishlistRepository, transaction: p.transaction });
  await assert.rejects(failing.add('b2c', customer, simple.id), /presentation failed/);
  assert.equal(p.wishlistRows.size, 0);
});
