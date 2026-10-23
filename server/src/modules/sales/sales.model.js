import mongoose from 'mongoose';

const name = new mongoose.Schema({
  ar: { type: String, required: true, trim: true, maxlength: 150 },
  en: { type: String, required: true, trim: true, maxlength: 150 },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  name: { type: name, required: true },
  targetType: { type: String, enum: ['products', 'category'], required: true },
  productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true, min: 1, max: 1000000000, validate: Number.isSafeInteger },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  isEnabled: { type: Boolean, default: true },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, isEnabled: 1, startsAt: 1, endsAt: 1 });
schema.index({ store: 1, productIds: 1 });
schema.index({ store: 1, categoryId: 1 });
export const Sale = mongoose.model('Sale', schema);

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  saleId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });
audit.index({ store: 1, createdAt: -1 });
export const SaleAudit = mongoose.model('SaleAudit', audit);
