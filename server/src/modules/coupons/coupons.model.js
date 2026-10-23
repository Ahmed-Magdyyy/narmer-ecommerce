import mongoose from 'mongoose';

const name = new mongoose.Schema({
  ar: { type: String, required: true, trim: true, maxlength: 150 },
  en: { type: String, required: true, trim: true, maxlength: 150 },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9][A-Z0-9_-]{2,39}$/ },
  name: { type: name, required: true },
  targetType: { type: String, enum: ['all', 'products', 'category'], required: true },
  productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true, min: 1, max: 1000000000, validate: Number.isSafeInteger },
  minimumSpend: { type: Number, default: 0, min: 0, max: 1000000000000000, validate: Number.isSafeInteger },
  maxUses: { type: Number, default: null, min: 1, max: 1000000000, validate: value => value == null || Number.isSafeInteger(value) },
  maxUsesPerPerson: { type: Number, default: null, min: 1, max: 1000000000, validate: value => value == null || Number.isSafeInteger(value) },
  usedCount: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  isEnabled: { type: Boolean, default: true },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, code: 1 }, { unique: true });
schema.index({ store: 1, productIds: 1 });
schema.index({ store: 1, categoryId: 1 });
export const Coupon = mongoose.model('Coupon', schema);

const redemption = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  couponId: { type: mongoose.Schema.Types.ObjectId, required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerKey: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  discountAmount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { timestamps: true, strict: 'throw' });
redemption.index({ store: 1, orderId: 1 }, { unique: true });
redemption.index({ store: 1, couponId: 1, customerKey: 1 });
export const CouponRedemption = mongoose.model('CouponRedemption', redemption);

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  couponId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });
audit.index({ store: 1, createdAt: -1 });
export const CouponAudit = mongoose.model('CouponAudit', audit);
