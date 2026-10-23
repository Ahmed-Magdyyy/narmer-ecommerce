import test from 'node:test';
import assert from 'node:assert/strict';
import { cartFixture } from './helpers/cart.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { Cart } from '../src/modules/cart/cart.model.js';
import { cartRepository } from '../src/modules/cart/cart.repository.js';
import { createCartService, guestCartLifetimeMs } from '../src/modules/cart/cart.service.js';

const admin = { userId: 'a'.repeat(24), role: 'superAdmin', store: 'b2c' };
const customer = { identity: { userId: 'b'.repeat(24), role: 'user', store: 'b2c' } };
const other = { identity: { userId: 'c'.repeat(24), role: 'user', store: 'b2c' } };
const guest = { guestToken: 'x'.repeat(43) };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== identity.store || !roles.includes(identity.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
  return { _id: identity.userId };
} };
async function fixture() {
  const f = cartFixture(auth);
  const category = await f.categories.create('b2c', admin, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const simple = await f.products.create('b2c', admin, simpleInput(category.id));
  const variant = await f.products.create('b2c', admin, variantInput(category.id));
  return { ...f, category, simple, variant };
}

test('cart stores only item selections, resolves current prices/images and never reserves stock', async () => {
  const f = await fixture();
  assert.deepEqual(await f.cart.get('b2c', guest), { items: [], itemCount: 0, subtotal: 0, currency: 'EGP', canCheckout: false });
  assert.equal(f.cartRows.size, 1);
  const added = await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 2, price: 1, ownerKey: 'fake' }, 'ar');
  assert.equal(added.items[0].name, 'قميص');
  assert.equal(added.subtotal, 50000);
  assert.equal(f.rows.get(f.simple.id).stock, 10);
  assert.equal(added.ownerKey, undefined);
  const stored = [...f.cartRows.values()][0];
  assert.match(stored.ownerKey, /^g:[a-f0-9]{64}$/);
  assert.equal(stored.ownerKey.includes(guest.guestToken), false);
  assert.equal(stored.items[0].price, undefined);
  await f.products.update('b2c', admin, f.simple.id, { version: 0, discountedPrice: 0 });
  assert.equal((await f.cart.get('b2c', guest)).subtotal, 0);
  await f.cart.setItem('b2c', guest, { productId: f.variant.id, variantId: f.variant.variants[0].id, quantity: 3 });
  const both = await f.cart.get('b2c', guest);
  assert.equal(both.items.length, 2);
  assert.equal(both.subtotal, 75000);
  assert.deepEqual(both.items[1].values, { size: 'small' });
  assert.equal((await f.cart.get('b2c', other)).items.length, 0);
  await f.products.update('b2c', admin, f.simple.id, { version: 1, stock: 1 });
  assert.equal((await f.cart.get('b2c', guest)).items[0].status, 'insufficient_stock');
  await f.categories.update('b2c', admin, f.category.id, { isActive: false });
  const hidden = await f.cart.get('b2c', guest);
  assert.equal(hidden.subtotal, null);
  assert.equal(hidden.items[0].name, null);
  assert.equal(hidden.canCheckout, false);
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 0 });
  assert.equal((await f.cart.get('b2c', guest)).items.length, 1);
  await f.cart.clear('b2c', guest);
  assert.equal(f.cartRows.size, 1);
});

test('GET creates one cart per guest/customer, preserves existing selections and expiry, and resets expired guests', async () => {
  const f = await fixture();
  const empty = { items: [], itemCount: 0, subtotal: 0, currency: 'EGP', canCheckout: false };
  assert.deepEqual(await Promise.all([f.cart.get('b2c', guest), f.cart.get('b2c', guest)]), [empty, empty]);
  assert.equal(f.cartRows.size, 1);
  const created = structuredClone([...f.cartRows.values()][0]);
  assert.equal(created.expiresAt.toISOString(), '2026-11-10T00:00:00.000Z');
  f.advance(1000);
  await f.cart.get('b2c', guest);
  assert.deepEqual([...f.cartRows.values()][0], created);
  assert.deepEqual(await f.cart.get('b2c', customer), empty);
  assert.equal(f.cartRows.size, 2);
  assert.equal(f.cartRows.get(`b2c:u:${customer.identity.userId}`).expiresAt, null);
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 1 });
  const selected = structuredClone([...f.cartRows.values()][0]);
  assert.equal((await f.cart.get('b2c', guest)).itemCount, 1);
  assert.deepEqual([...f.cartRows.values()][0], selected);
  f.advance(guestCartLifetimeMs);
  assert.deepEqual(await f.cart.get('b2c', guest), empty);
  const reset = [...f.cartRows.values()][0];
  assert.deepEqual(reset.items, []);
  assert.equal(reset.expiresAt.getTime() - selected.expiresAt.getTime(), guestCartLifetimeMs);
  assert.equal(reset.version, selected.version + 1);
  await f.cart.clear('b2c', guest);
  assert.equal(f.cartRows.size, 1);
  assert.deepEqual(await f.cart.get('b2c', guest), empty);
  assert.equal(f.cartRows.size, 2);
  f.failWrite(true);
  await assert.rejects(f.cart.get('b2c', other), /cart write failed/);
  assert.equal(f.cartRows.size, 2);
});

test('cart validates product/variant selections and quantities without silently changing them', async () => {
  const f = await fixture();
  for (const quantity of [-1, 1.5, '1', null, 10001]) {
    await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity }), { code: 'VALIDATION_ERROR' });
  }
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: 'wrong', quantity: 1 }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.simple.id, variantId: f.variant.variants[0].id, quantity: 1 }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.variant.id, quantity: 1 }), { code: 'CART_VARIANT_NOT_FOUND' });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.variant.id, variantId: 'f'.repeat(24), quantity: 1 }), { code: 'CART_VARIANT_NOT_FOUND' });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 11 }), { code: 'CART_INSUFFICIENT_STOCK' });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: 'f'.repeat(24), quantity: 1 }), { code: 'PRODUCT_NOT_FOUND' });
  await assert.rejects(f.cart.get('b2b', guest), { code: 'INVALID_STORE' });
  await assert.rejects(f.cart.get('b2c', { guestToken: 'short' }), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.cart.get('b2c', { identity: admin }), { code: 'FORBIDDEN' });
  await f.products.update('b2c', admin, f.simple.id, { version: 0, isActive: false });
  await assert.rejects(f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 1 }), { code: 'PRODUCT_NOT_FOUND' });
  assert.equal(f.cartRows.size, 0);
});

test('cart merge combines quantities once and rolls back both carts on unavailable stock or failed writes', async () => {
  const f = await fixture();
  await f.cart.setItem('b2c', customer, { productId: f.simple.id, quantity: 2 });
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 3 });
  await f.cart.setItem('b2c', guest, { productId: f.variant.id, variantId: f.variant.variants[1].id, quantity: 1 });
  assert.equal((await f.cart.merge('b2c', customer, guest.guestToken)).itemCount, 6);
  assert.equal((await f.cart.merge('b2c', customer, guest.guestToken)).itemCount, 6);
  assert.equal((await f.cart.get('b2c', guest)).items.length, 0);
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 6 });
  const before = structuredClone([...f.cartRows]);
  await assert.rejects(f.cart.merge('b2c', customer, guest.guestToken), { code: 'CART_MERGE_UNAVAILABLE' });
  assert.deepEqual([...f.cartRows], before);
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 1 });
  const saved = structuredClone([...f.cartRows]);
  f.failWrite(true);
  await assert.rejects(f.cart.merge('b2c', customer, guest.guestToken), /cart write failed/);
  assert.deepEqual([...f.cartRows], saved);
  f.failWrite(false);
  assert.equal((await f.cart.merge('b2c', customer, guest.guestToken)).itemCount, 7);
  await assert.rejects(f.cart.merge('b2c', guest, guest.guestToken), { code: 'UNAUTHORIZED' });
  await Promise.all([
    f.cart.setItem('b2c', other, { productId: f.simple.id, quantity: 1 }),
    f.cart.setItem('b2c', other, { productId: f.variant.id, variantId: f.variant.variants[0].id, quantity: 1 }),
  ]);
  assert.equal((await f.cart.get('b2c', other)).items.length, 2);
});

test('active carts block product/variant removal; expired guest carts do not block deletion or resurrect items', async () => {
  const f = await fixture();
  const selected = f.variant.variants[0];
  await f.cart.setItem('b2c', guest, { productId: f.variant.id, variantId: selected.id, quantity: 1 });
  await assert.rejects(f.products.remove('b2c', admin, f.variant.id), { code: 'PRODUCT_REFERENCED' });
  await assert.rejects(f.products.update('b2c', admin, f.variant.id, { version: 0, variants: [f.variant.variants[1]] }), { code: 'PRODUCT_REFERENCED' });
  f.advance(guestCartLifetimeMs + 1);
  assert.equal((await f.cart.get('b2c', guest)).items.length, 0);
  await f.products.update('b2c', admin, f.variant.id, { version: 0, variants: [f.variant.variants[1]] });
  await f.cart.setItem('b2c', guest, { productId: f.simple.id, quantity: 1 });
  assert.equal((await f.cart.get('b2c', guest)).items.length, 1);
  await f.products.remove('b2c', admin, f.variant.id);
  await f.cart.setItem('b2c', customer, { productId: f.simple.id, quantity: 1 });
  f.advance(guestCartLifetimeMs + 1);
  assert.equal((await f.cart.get('b2c', customer)).items.length, 1);
  await assert.rejects(f.products.remove('b2c', admin, f.simple.id), { code: 'PRODUCT_REFERENCED' });
});

test('cart repository enforces owner/store/version conditions, logical expiry and singleton/TTL indexes', async () => {
  const session = { marker: true };
  const query = cartRepository.replace('b2c', `u:${customer.identity.userId}`, 3, [], null, session);
  assert.deepEqual(query.getFilter(), { store: 'b2c', ownerKey: `u:${customer.identity.userId}`, version: 3 });
  assert.deepEqual(query.getOptions().session, session);
  assert.deepEqual(query.getUpdate().$inc, { version: 1 });
  assert.deepEqual(cartRepository.find('b2c', `u:${customer.identity.userId}`, session).getFilter(), { store: 'b2c', ownerKey: `u:${customer.identity.userId}` });
  assert.ok(Cart.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.ownerKey === 1 && options.unique));
  assert.ok(Cart.schema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
  await assert.rejects(new Cart({ store: 'b2b', ownerKey: 'unsafe' }).validate(), { name: 'ValidationError' });
  const f = await fixture();
  const conflict = createCartService({ auth, products: f.products, transaction: f.transaction,
    repository: { ...f.cartRepository, async create() { throw Object.assign(new Error('duplicate'), { code: 11000 }); } } });
  await assert.rejects(conflict.setItem('b2c', guest, { productId: f.simple.id, quantity: 1 }), { code: 'CART_CONFLICT' });
});
