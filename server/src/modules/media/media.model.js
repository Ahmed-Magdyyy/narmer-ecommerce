import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true },
  kind: { type: String, enum: ['product', 'category', 'size-chart-en', 'size-chart-ar', 'homepage-desktop', 'homepage-mobile'], required: true, immutable: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  objectKey: { type: String, required: true, immutable: true },
  endpoint: { type: String, required: true, immutable: true },
  zone: { type: String, required: true, immutable: true },
  url: { type: String, required: true, immutable: true },
  width: { type: Number, required: true }, height: { type: Number, required: true },
  status: { type: String, enum: ['uploading', 'ready', 'attached', 'deletePending'], required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' });
schema.index({ objectKey: 1 }, { unique: true });
schema.index({ status: 1, expiresAt: 1 });
schema.index({ store: 1, kind: 1, targetId: 1 });
export const Media = mongoose.model('Media', schema);
