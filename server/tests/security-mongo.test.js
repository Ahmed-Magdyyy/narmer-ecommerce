import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import { createCouponsService } from '../src/modules/coupons/coupons.service.js';
import { couponsRepository } from '../src/modules/coupons/coupons.repository.js';
import { Coupon, CouponRedemption } from '../src/modules/coupons/coupons.model.js';
import { runTransaction } from '../src/shared/utils/transaction.js';
import { testConfig } from './helpers/config.js';

const uri = process.env.NARMER_TEST_MONGODB_URI;
test('real MongoDB retains legacy coupon caps and serializes keyed-phone redemption limits', { skip: !uri }, async t => {
  const dbName = `narmer_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
  t.after(async () => {
    try {
      assert.equal(mongoose.connection.name, dbName); assert.match(dbName, /^narmer_test_[a-f0-9]{24}$/);
      for (const row of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.dropCollection(row.name);
      assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
    } finally { await mongoose.disconnect(); }
  });
  await couponsRepository.initialize();
  const user = { _id: new mongoose.Types.ObjectId() }, owner = { guestToken: 'a'.repeat(43) };
  const service = createCouponsService({ identitySecret: testConfig.couponIdentitySecret,
    auth: { async authorizeStaff() { return user; } }, categories: { async lockForCatalog() {} },
    cart: { async getForCoupon() { return { canCheckout: true, subtotal: 10000,
      items: [{ productId: '1'.repeat(24), variantId: null, quantity: 1, lineTotal: 10000, activeSale: null }] }; } } });
  const coupon = await service.create('b2c', user, { code: 'SECURITY20', name: { ar: 'اختبار', en: 'Test' },
    targetType: 'all', discountType: 'percentage', discountValue: 20, maxUsesPerPerson: 1 });
  const legacy = createHash('sha256').update('b2c:201001234567').digest('hex');
  await CouponRedemption.create({ store: 'b2c', couponId: coupon.id, orderId: new mongoose.Types.ObjectId(), customerKey: legacy, discountAmount: 2000 });
  await Coupon.updateOne({ _id: coupon.id }, { $set: { usedCount: 1 } });
  await assert.rejects(service.preview('b2c', owner, coupon.code, '01001234567'), { code: 'COUPON_PERSON_LIMIT_REACHED' });
  await assert.rejects(service.preview('b2c', owner, coupon.code, '+20 (100) 123-4567'), { code: 'COUPON_PERSON_LIMIT_REACHED' });
  const redeem = phone => runTransaction(session => service.redeem('b2c', owner, coupon.code, phone,
    { session, orderId: String(new mongoose.Types.ObjectId()) }));
  const results = await Promise.allSettled([redeem('01009876543'), redeem('+201009876543')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'COUPON_PERSON_LIMIT_REACHED');
  const expected = createHmac('sha256', testConfig.couponIdentitySecret).update('coupon-person:b2c:201009876543').digest('hex');
  const oldNewPhone = createHash('sha256').update('b2c:201009876543').digest('hex');
  const inserted = await CouponRedemption.findOne({ couponId: coupon.id, customerKey: expected }).lean();
  assert.ok(inserted); assert.notEqual(inserted.customerKey, oldNewPhone);
  assert.equal(await couponsRepository.countPersonUses('b2c', coupon.id, [expected, oldNewPhone]), 1);
  assert.equal(await couponsRepository.countPersonUses('b2b', coupon.id, [expected, oldNewPhone]), 0);
  assert.equal(await CouponRedemption.countDocuments({ couponId: coupon.id }), 2);
  assert.equal((await Coupon.findById(coupon.id).lean()).usedCount, 2);
  assert.equal(await CouponRedemption.countDocuments({ customerKey: legacy }), 1);
});
