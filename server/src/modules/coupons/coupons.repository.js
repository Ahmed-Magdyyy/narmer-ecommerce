import { Coupon, CouponAudit, CouponRedemption } from './coupons.model.js';

export const couponsRepository = {
  initialize: () => Promise.all([Coupon.init(), CouponAudit.init(), CouponRedemption.init()]),
  list: (store, { page, limit, isEnabled, targetType }) => {
    const filter = { store, ...(isEnabled === undefined ? {} : { isEnabled }), ...(targetType ? { targetType } : {}) };
    return Promise.all([Coupon.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Coupon.countDocuments(filter)]);
  },
  findById: (store, couponId, session = null) => Coupon.findOne({ store, _id: couponId }).session(session).lean(),
  findByCode: (store, code, session) => Coupon.findOne({ store, code }).session(session).lean(),
  create: async (data, session) => (await Coupon.create([data], { session }))[0].toObject(),
  update: (store, couponId, fields, session) => Coupon.findOneAndUpdate({ store, _id: couponId }, { $set: fields },
    { returnDocument: 'after', runValidators: true, session }).lean(),
  remove: (store, couponId, session) => Coupon.deleteOne({ store, _id: couponId }, { session }),
  audit: (data, session) => CouponAudit.create([data], { session }),
  hasProductReferences: (store, productId, session) => Coupon.exists({ store, productIds: productId }).session(session),
  hasCategoryReferences: (store, categoryId, session) => Coupon.exists({ store, categoryId }).session(session),
  hasRedemptions: (store, couponId, session) => CouponRedemption.exists({ store, couponId }).session(session),
  countPersonUses: (store, couponId, customerKeys, session) => CouponRedemption.countDocuments({ store, couponId, customerKey: { $in: customerKeys } }).session(session),
  findOrderRedemption: (store, orderId, session) => CouponRedemption.findOne({ store, orderId }).session(session).lean(),
  incrementUsage: (store, couponId, usedCount, session) => Coupon.findOneAndUpdate({ store, _id: couponId, usedCount },
    { $inc: { usedCount: 1 } }, { returnDocument: 'after', runValidators: true, session }).lean(),
  recordRedemption: async (data, session) => (await CouponRedemption.create([data], { session }))[0].toObject(),
};
