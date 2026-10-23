import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  event: { type: String, enum: ['order.placed', 'order.status', 'lead.submitted', 'lead.contacted'], required: true },
  resourceStatus: { type: String, required: true }, eventAt: { type: Date, required: true },
  to: { type: String, required: true }, locale: { type: String, enum: ['ar', 'en'], required: true },
  state: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'skipped'], default: 'pending' },
  attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, required: true },
  leaseId: { type: String, default: null }, leaseUntil: { type: Date, default: null },
  sentAt: { type: Date, default: null }, lastCode: { type: String, default: null },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, resourceId: 1, event: 1, resourceStatus: 1 }, { unique: true });
schema.index({ store: 1, state: 1, nextAttemptAt: 1, leaseUntil: 1 });
export const EmailDelivery = mongoose.model('EmailDelivery', schema);
