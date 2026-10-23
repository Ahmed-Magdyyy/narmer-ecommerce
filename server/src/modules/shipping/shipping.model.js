import mongoose from 'mongoose';

const money = { type: Number, required: true, min: 0, max: 1000000000, validate: Number.isSafeInteger };
const names = new mongoose.Schema({
  ar: { type: String, required: true, trim: true, maxlength: 150 },
  en: { type: String, required: true, trim: true, maxlength: 150 },
}, { _id: false, strict: 'throw' });
const fee = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  governorateCode: { type: String, required: true, immutable: true, maxlength: 100, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  name: { type: names, required: true },
  fee: money,
}, { timestamps: true, strict: 'throw' });
fee.index({ store: 1, governorateCode: 1 }, { unique: true });
export const ShippingFee = mongoose.model('ShippingFee', fee);

export const ShippingSettings = mongoose.model('ShippingSettings', new mongoose.Schema({
  _id: { type: String, enum: ['b2c'], required: true }, defaultFee: money,
}, { timestamps: true, strict: 'throw' }));

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  feeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  governorateCode: { type: String, default: null },
  action: { type: String, enum: ['created', 'updated', 'deleted', 'default.updated'], required: true },
  fields: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });
audit.index({ store: 1, createdAt: -1 });
export const ShippingAudit = mongoose.model('ShippingAudit', audit);
