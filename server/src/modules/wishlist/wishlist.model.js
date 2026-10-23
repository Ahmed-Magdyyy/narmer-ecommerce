import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  productIds: { type: [mongoose.Schema.Types.ObjectId], default: [], validate: value => value.length <= 100 },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, userId: 1 }, { unique: true });
schema.index({ store: 1, productIds: 1 });
export const Wishlist = mongoose.model('Wishlist', schema);
