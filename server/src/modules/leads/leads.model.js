import mongoose from 'mongoose';
import { formTypes } from '../forms/forms.definitions.js';

const objectId = mongoose.Schema.Types.ObjectId;
const draft = new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true },
  formType: { type: String, enum: formTypes, required: true },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['open', 'submitted'], default: 'open' },
  imageSlots: { type: Number, min: 0, max: 5, default: 0 },
  revision: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' });
draft.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const LeadDraft = mongoose.model('LeadDraft', draft);
const image = new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true }, draftId: { type: objectId, required: true },
  leadId: { type: objectId, default: null },
  status: { type: String, enum: ['uploading', 'ready', 'attached', 'failed', 'deletePending'], required: true },
  objectKey: { type: String, required: true }, endpoint: { type: String, required: true }, zone: { type: String, required: true },
  width: { type: Number, required: true }, height: { type: Number, required: true }, expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' });
image.index({ store: 1, draftId: 1 }); image.index({ status: 1, expiresAt: 1 });
export const LeadImage = mongoose.model('LeadImage', image);
const lead = new mongoose.Schema({
  notificationLocale: { type: String, enum: ['ar', 'en'], default: 'en' },
  store: { type: String, enum: ['b2b'], required: true }, draftId: { type: objectId, required: true },
  draftTokenHash: { type: String, required: true, select: false }, requestHash: { type: String, required: true, select: false },
  formType: { type: String, enum: formTypes, required: true }, userId: { type: objectId, default: null },
  formSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  contact: { type: mongoose.Schema.Types.Mixed, required: true }, answers: { type: mongoose.Schema.Types.Mixed, required: true },
  wholesaleRequests: { type: [mongoose.Schema.Types.Mixed], default: [] }, imageIds: { type: [objectId], default: [] },
  status: { type: String, enum: ['submitted', 'contacted'], default: 'submitted' },
  contactedAt: { type: Date, default: null }, contactedBy: { type: objectId, default: null },
  trackingHash: { type: String, default: null, select: false }, trackingExpiresAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
lead.index({ store: 1, draftId: 1 }, { unique: true });
lead.index({ store: 1, userId: 1, createdAt: -1 }); lead.index({ store: 1, status: 1, createdAt: -1 });
lead.index({ store: 1, 'wholesaleRequests.id': 1 });
export const Lead = mongoose.model('Lead', lead);
export const LeadAudit = mongoose.model('LeadAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true }, leadId: { type: objectId, required: true },
  actorId: { type: objectId, required: true }, action: { type: String, enum: ['contacted'], required: true },
}, { timestamps: true, strict: 'throw' }));
