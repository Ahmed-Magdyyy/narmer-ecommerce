import mongoose from 'mongoose';

const line = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, required: true, min: 1, max: 10000, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  ownerKey: { type: String, required: true, immutable: true, match: /^(?:u:[a-f0-9]{24}|g:[a-f0-9]{64})$/ },
  items: { type: [line], default: [], validate: value => value.length <= 100 },
  version: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  expiresAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, ownerKey: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ store: 1, 'items.productId': 1 });
export const Cart = mongoose.model('Cart', schema);
