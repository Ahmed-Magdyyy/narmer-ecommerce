import mongoose from 'mongoose';

const localized = (max, required = false) => new mongoose.Schema({
  en: { type: String, maxlength: max, required }, ar: { type: String, maxlength: max, required },
}, { _id: false, strict: 'throw' });
const url = { type: String, default: null, maxlength: 2048 };
const settings = new mongoose.Schema({
  _id: { type: String, enum: ['b2c', 'b2b'], required: true },
  version: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
  phone: { type: String, default: null, maxlength: 16 },
  email: { type: String, default: null, maxlength: 254 },
  address: { type: localized(1000), required: true }, mapUrl: url,
  social: { instagramUrl: url, whatsappUrl: url, tiktokUrl: url, facebookUrl: url },
  seo: { title: { type: localized(200, true), required: true },
    description: { type: localized(500), required: true }, keywords: { type: String, maxlength: 1000, default: '' } },
}, { timestamps: true, strict: 'throw' });
export const SiteSettings = mongoose.model('SiteSettings', settings);
export const SiteSettingsAudit = mongoose.model('SiteSettingsAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true }, fields: { type: [String], required: true },
}, { timestamps: true, strict: 'throw' }));
