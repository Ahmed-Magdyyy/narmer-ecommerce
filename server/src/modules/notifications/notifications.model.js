import mongoose from 'mongoose';

const notification = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true },
  type: { type: String, enum: ['order.placed', 'lead.submitted'], required: true, immutable: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });
notification.index({ store: 1, type: 1, resourceId: 1 }, { unique: true });
notification.index({ store: 1, occurredAt: -1, _id: -1 });
export const Notification = mongoose.model('Notification', notification);

const read = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  notificationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  readAt: { type: Date, required: true, immutable: true },
}, { strict: 'throw' });
read.index({ store: 1, userId: 1, notificationId: 1 }, { unique: true });
export const NotificationRead = mongoose.model('NotificationRead', read);
