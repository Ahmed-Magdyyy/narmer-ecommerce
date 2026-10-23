import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCouponDiscount, createCouponsService } from '../src/modules/coupons/coupons.service.js';
import { createHash, createHmac } from 'node:crypto';
import { testConfig } from './helpers/config.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { cartFixture } from './helpers/cart.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { couponsFixture, couponInput } from './helpers/coupons.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { couponsRepository } from '../src/modules/coupons/coupons.repository.js';
import { Coupon, CouponRedemption } from '../src/modules/coupons/coupons.model.js';

const cart = entries => ({ canCheckout: true, subtotal: entries.reduce((sum, item) => sum + item.total, 0),
  items: entries.map((item, index) => ({ productId: String(index).padStart(24, '0'), variantId: null,
    lineTotal: item.total, activeSale: item.sale ? { id: 'a'.repeat(24) } : null })) });

test('Coupon calculations exclude sale lines, accept saved-discount lines and cap fixed discounts to eligible subtotal', () => {
  const mixed = cart([{ total: 20000, sale: true }, { total: 10000 }, { total: 5000 }]);
  mixed.items[1].discountedPrice = 5000;
  const percentage = calculateCouponDiscount(mixed, { discountType: 'percentage', discountValue: 20 });
  assert.equal(percentage.eligibleSubtotal, 15000);
  assert.equal(percentage.discountAmount, 3000);
  assert.equal(percentage.subtotalAfterDiscount, 32000);
  assert.deepEqual(percentage.allocations.map(line => line.discountAmount), [0, 2000, 1000]);
  assert.deepEqual(percentage.allocations.map(line => line.eligible), [false, true, true]);
  const fixed = calculateCouponDiscount(mixed, { discountType: 'fixed', discountValue: 50000 });
  assert.equal(fixed.discountAmount, 15000);
  assert.equal(fixed.subtotalAfterDiscount, 20000);
  assert.deepEqual(fixed.allocations.map(line => line.lineTotalAfterDiscount), [20000, 0, 0]);
  assert.throws(() => calculateCouponDiscount(cart([{ total: 0, sale: true }]), { discountType: 'fixed', discountValue: 1 }), { code: 'COUPON_NO_ELIGIBLE_ITEMS' });
  assert.throws(() => calculateCouponDiscount({ ...mixed, canCheckout: false }, { discountType: 'fixed', discountValue: 1 }), { code: 'CART_COUPON_UNAVAILABLE' });
});

const owner = { _id: '1'.repeat(24), role: 'superAdmin' };
const admin = { _id: '2'.repeat(24), role: 'admin' };
const guest = { guestToken: 'a'.repeat(43) };
const auth = { async authorizeStaff(store, identity, roles) {
  if (store !== 'b2c' || !roles.includes(identity?.role)) throw new AppError(403, 'FORBIDDEN'); return identity;
} };
async function fixture() {
  const p = cartFixture(auth), s = salesFixture(auth, p);
  const f = couponsFixture(auth, { ...p, sales: s.sales, transaction: s.transaction });
  const root = await f.categories.create('b2c', owner, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const child = await f.categories.create('b2c', owner, { name: { ar: 'فرع', en: 'Child' }, slug: 'child', parentId: root.id });
  const product = await f.products.create('b2c', owner, simpleInput(child.id));
  await f.cart.setItem('b2c', guest, { productId: product.id, quantity: 2 });
  return { ...f, p, s, root, child, product };
}

test('Coupon definitions validate scopes, limits, schedules, code uniqueness, partial changes and audit rollback', async () => {
  const f = await fixture();
  const created = await f.coupons.create('b2c', admin, couponInput({ code: ' welcome20 ', usedCount: 99, currency: 'USD' }));
  assert.equal(created.code, 'WELCOME20'); assert.equal(created.usedCount, 0); assert.equal(created.status, 'active');
  assert.equal(created.minimumSpend, 0); assert.equal(created.maxUses, null); assert.equal(created.startsAt, null);
  await assert.rejects(f.coupons.create('b2c', owner, couponInput()), { code: 'COUPON_CODE_EXISTS' });
  for (const fields of [{ discountValue: 101 }, { discountValue: '20' }, { minimumSpend: null }, { maxUses: 0 }, { maxUsesPerPerson: 1.5 },
    { targetType: 'all', productIds: [f.product.id] }, { targetType: 'products', productIds: [] },
    { targetType: 'category', categoryId: f.root.id, productIds: [f.product.id] },
    { startsAt: '2026-10-12T12:00:00Z', endsAt: '2026-10-11T12:00:00Z' }]) {
    await assert.rejects(f.coupons.create('b2c', owner, couponInput({ code: 'OTHER', ...fields })), { code: 'INVALID_COUPON' });
  }
  await assert.rejects(f.coupons.create('b2c', owner, couponInput({ code: 'MISSING', targetType: 'products', productIds: ['f'.repeat(24)] })), { code: 'COUPON_TARGET_NOT_FOUND' });
  const updated = await f.coupons.update('b2c', admin, created.id, { name: { en: 'Updated' }, targetType: 'category', categoryId: f.root.id,
    startsAt: '2026-10-11T12:00:00Z', endsAt: '2026-10-12T12:00:00Z' });
  assert.equal(updated.name.ar, created.name.ar); assert.equal(updated.name.en, 'Updated');
  f.at('2026-10-11T11:59:59Z'); assert.equal((await f.coupons.getStaff('b2c', owner, created.id)).status, 'scheduled');
  f.at(updated.endsAt); assert.equal((await f.coupons.getStaff('b2c', owner, created.id)).status, 'expired');
  assert.equal((await f.coupons.update('b2c', admin, created.id, { startsAt: null, endsAt: null })).status, 'active');
  f.failAudit(true);
  await assert.rejects(f.coupons.create('b2c', admin, couponInput({ code: 'AUDIT' })), /audit failed/);
  await assert.rejects(f.coupons.update('b2c', admin, created.id, { discountValue: 50 }), /audit failed/);
  await assert.rejects(f.coupons.remove('b2c', owner, created.id), /audit failed/);
  assert.equal(f.rows.size, 1); assert.equal(f.rows.get(created.id).discountValue, 20);
});

test('Coupon preview uses live Cart ownership, scoped products/variants/descendants, excludes sale lines and checks only eligible spend', async () => {
  const f = await fixture();
  const variant = await f.products.create('b2c', owner, variantInput(f.child.id));
  await f.cart.setItem('b2c', guest, { productId: variant.id, variantId: variant.variants[0].id, quantity: 1 });
  await f.s.sales.create('b2c', owner, saleInput(f.product.id));
  const coupon = await f.coupons.create('b2c', admin, couponInput({ targetType: 'category', categoryId: f.root.id, minimumSpend: 25000 }));
  const preview = await f.coupons.preview('b2c', guest, 'welcome20', '+201001234567', 'ar');
  assert.equal(preview.subtotal, 65000); assert.equal(preview.eligibleSubtotal, 25000); assert.equal(preview.discountAmount, 5000);
  assert.equal(preview.coupon.name, 'خصم ترحيبي'); assert.deepEqual(preview.allocations.map(row => row.discountAmount), [0, 5000]);
  assert.equal(f.rows.get(coupon.id).usedCount, 0); assert.equal(f.redemptions.length, 0);
  await f.coupons.update('b2c', admin, coupon.id, { minimumSpend: 25001 });
  await assert.rejects(f.coupons.preview('b2c', guest, 'WELCOME20', '+201001234567'), { code: 'COUPON_MINIMUM_SPEND' });
  await f.coupons.update('b2c', admin, coupon.id, { targetType: 'products', productIds: [f.product.id], minimumSpend: 0 });
  await assert.rejects(f.coupons.preview('b2c', guest, 'WELCOME20', '+201001234567'), { code: 'COUPON_NO_ELIGIBLE_ITEMS' });
  await f.coupons.update('b2c', admin, coupon.id, { productIds: [variant.id], discountType: 'fixed', discountValue: 50000 });
  assert.equal((await f.coupons.preview('b2c', guest, 'WELCOME20', '+201001234567')).discountAmount, 25000);
  await f.coupons.update('b2c', admin, coupon.id, { targetType: 'all', discountType: 'percentage', discountValue: 20 });
  f.at('2026-10-12T12:00:00Z');
  const afterSale = await f.coupons.preview('b2c', guest, 'WELCOME20', '+201001234567');
  assert.equal(afterSale.eligibleSubtotal, 75000); assert.equal(afterSale.discountAmount, 15000);
  await f.coupons.update('b2c', admin, coupon.id, { isEnabled: false });
  await assert.rejects(f.coupons.preview('b2c', guest, 'WELCOME20', '+201001234567'), { code: 'COUPON_UNAVAILABLE' });
  await assert.rejects(f.coupons.preview('b2c', { guestToken: 'z'.repeat(43) }, 'WELCOME20', '+201001234567'), { code: 'COUPON_UNAVAILABLE' });
  await assert.rejects(f.coupons.preview('b2c', { identity: owner }, 'WELCOME20', '+201001234567'), { code: 'FORBIDDEN' });
});

test('Coupon usage records only inside a successful order transaction, blocks replay and serializes global/person limits', async () => {
  const f = await fixture();
  const coupon = await f.coupons.create('b2c', owner, couponInput({ maxUses: 2, maxUsesPerPerson: 1 }));
  await assert.rejects(f.coupons.redeem('b2c', guest, coupon.code, '+201001234567', { orderId: '3'.repeat(24) }), /requires the order transaction/);
  const redeem = (phone, orderId) => f.transaction(session => f.coupons.redeem('b2c', guest, coupon.code, phone, { session, orderId, at: f.now() }));
  const results = await Promise.allSettled([redeem('0100 123 4567', '3'.repeat(24)), redeem('+20 (100) 123-4567', '4'.repeat(24))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'COUPON_PERSON_LIMIT_REACHED');
  assert.equal(f.rows.get(coupon.id).usedCount, 1); assert.equal(f.redemptions.length, 1);
  assert.equal(f.redemptions[0].customerKey.length, 64); assert.equal(f.redemptions[0].customerKey.includes('1001234567'), false);
  const orderId = f.redemptions[0].orderId;
  await assert.rejects(redeem('+201001234567', orderId), { code: 'COUPON_ALREADY_REDEEMED' });
  f.failRecord(true);
  await assert.rejects(redeem('+201009876543', '5'.repeat(24)), /record failed/);
  assert.equal(f.rows.get(coupon.id).usedCount, 1);
  f.failRecord(false);
  await assert.rejects(f.transaction(async session => {
    await f.coupons.redeem('b2c', guest, coupon.code, '+201009876543', { session, orderId: '5'.repeat(24), at: f.now() });
    throw new Error('order failed');
  }), /order failed/);
  assert.equal(f.redemptions.length, 1); assert.equal(f.rows.get(coupon.id).usedCount, 1);
  const globalRace = await Promise.allSettled([redeem('+201009876543', '5'.repeat(24)), redeem('+201007654321', '6'.repeat(24))]);
  assert.equal(globalRace.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(globalRace.find(row => row.status === 'rejected').reason.code, 'COUPON_UNAVAILABLE');
  assert.equal((await f.coupons.getStaff('b2c', owner, coupon.id)).status, 'exhausted');
  await assert.rejects(f.coupons.remove('b2c', owner, coupon.id), { code: 'COUPON_REFERENCED' });
});

test('Coupon permissions and target references protect catalog records without blocking variant removal', async () => {
  const f = await fixture();
  const coupon = await f.coupons.create('b2c', owner, couponInput({ targetType: 'products', productIds: [f.product.id], isEnabled: false }));
  await f.cart.clear('b2c', guest);
  await assert.rejects(f.products.remove('b2c', owner, f.product.id), { code: 'PRODUCT_REFERENCED' });
  await assert.rejects(f.coupons.remove('b2c', admin, coupon.id), { code: 'FORBIDDEN' });
  for (const role of ['moderator', 'user']) await assert.rejects(f.coupons.list('b2c', { ...owner, role }), { code: 'FORBIDDEN' });
  await assert.rejects(f.coupons.list('b2b', owner), { code: 'INVALID_STORE' });
  const variant = await f.products.create('b2c', owner, variantInput(f.child.id));
  await f.coupons.update('b2c', owner, coupon.id, { productIds: [variant.id] });
  const remaining = await f.products.update('b2c', owner, variant.id, { version: variant.version, variants: [variant.variants[1]] });
  assert.equal(remaining.variants.length, 1); assert.equal(remaining.variants[0].id, variant.variants[1].id);
  const empty = await f.categories.create('b2c', owner, { name: { ar: 'فارغ', en: 'Empty' }, slug: 'empty' });
  await f.coupons.update('b2c', owner, coupon.id, { targetType: 'category', categoryId: empty.id });
  await assert.rejects(f.categories.remove('b2c', owner, empty.id), { code: 'CATEGORY_HAS_COUPONS' });
  await f.coupons.remove('b2c', owner, coupon.id); await f.categories.remove('b2c', owner, empty.id);
  await f.products.remove('b2c', owner, f.product.id);
});

test('Coupon repository scopes usage and definition writes and indexes each order redemption uniquely', () => {
  assert.ok(Coupon.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.code === 1 && options.unique));
  assert.ok(CouponRedemption.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.orderId === 1 && options.unique));
  const session = { marker: true }, id = '3'.repeat(24);
  const increment = couponsRepository.incrementUsage('b2c', id, 2, session);
  assert.deepEqual(increment.getFilter(), { store: 'b2c', _id: id, usedCount: 2 });
  assert.deepEqual(increment.getOptions().session, session);
  const keys = ['a'.repeat(64), 'b'.repeat(64)];
  const uses = couponsRepository.countPersonUses('b2c', id, keys, session);
  assert.deepEqual(uses.getFilter(), { store: 'b2c', couponId: id, customerKey: { $in: keys } });
  assert.equal(uses.getOptions().session, session);
});

test('coupon phone identity is keyed, preserves legacy usage and requires a private stable secret', async () => {
  assert.throws(() => createCouponsService({}), /identity secret/);
  assert.throws(() => createCouponsService({ identitySecret: 'short' }), /identity secret/);
  const f = await fixture(), coupon = await f.coupons.create('b2c', owner, couponInput({ maxUsesPerPerson: 1 }));
  const legacy = createHash('sha256').update('b2c:201001234567').digest('hex');
  f.redemptions.push({ store: 'b2c', couponId: coupon.id, orderId: '9'.repeat(24), customerKey: legacy });
  await assert.rejects(f.coupons.preview('b2c', guest, coupon.code, '01001234567'), { code: 'COUPON_PERSON_LIMIT_REACHED' });
  await assert.rejects(f.coupons.preview('b2c', guest, coupon.code, '+20 (100) 123-4567'), { code: 'COUPON_PERSON_LIMIT_REACHED' });
  const phone = '01009876543';
  await f.transaction(session => f.coupons.redeem('b2c', guest, coupon.code, phone, { session, orderId: '8'.repeat(24), at: f.now() }));
  const key = f.redemptions.at(-1).customerKey;
  assert.equal(key, createHmac('sha256', testConfig.couponIdentitySecret).update('coupon-person:b2c:201009876543').digest('hex'));
  assert.notEqual(key, createHash('sha256').update('b2c:201009876543').digest('hex'));
  assert.notEqual(key, createHmac('sha256', 'other-stable-secret-'.repeat(3)).update('coupon-person:b2c:201009876543').digest('hex'));
  await assert.rejects(f.coupons.preview('b2c', guest, coupon.code, '+201009876543'), { code: 'COUPON_PERSON_LIMIT_REACHED' });
});

test('Coupon percentage totals and proportional allocations remain exact at maximum cart amounts and for leftover piastres', () => {
  const tiny = calculateCouponDiscount(cart([{ total: 1 }, { total: 1 }, { total: 1 }]), { discountType: 'fixed', discountValue: 2 });
  assert.deepEqual(tiny.allocations.map(line => line.discountAmount), [1, 1, 0]);
  for (const percent of [1, 33, 67, 99, 100]) {
    const maximum = cart(Array.from({ length: 100 }, (_, index) => ({ total: 10000000000000 - index, sale: index % 5 === 0 })));
    const result = calculateCouponDiscount(maximum, { discountType: 'percentage', discountValue: percent });
    assert.equal(result.discountAmount, Number(BigInt(result.eligibleSubtotal) * BigInt(percent) / 100n));
    assert.equal(result.allocations.reduce((sum, line) => sum + line.discountAmount, 0), result.discountAmount);
    result.allocations.forEach((line, index) => {
      assert.ok(Number.isSafeInteger(line.discountAmount));
      assert.ok(line.discountAmount >= 0 && line.discountAmount <= maximum.items[index].lineTotal);
      assert.equal(line.discountAmount + line.lineTotalAfterDiscount, maximum.items[index].lineTotal);
      if (maximum.items[index].activeSale) assert.equal(line.discountAmount, 0);
    });
  }
  const free = calculateCouponDiscount(cart([{ total: 0 }]), { discountType: 'percentage', discountValue: 50 });
  assert.equal(free.discountAmount, 0);
  assert.equal(free.allocations[0].lineTotalAfterDiscount, 0);
  for (const value of [0, 101, 1.5, '20', null]) {
    assert.throws(() => calculateCouponDiscount(cart([{ total: 100 }]), { discountType: 'percentage', discountValue: value }), { code: 'INVALID_COUPON' });
  }
});
