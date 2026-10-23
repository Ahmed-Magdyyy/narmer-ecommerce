import mongoose from 'mongoose';
import { imageSchema } from '../../shared/infrastructure/media/image-schema.js';
import { normalizeMeasurements } from './sizecharts.measurements.js';

const localized = (max, required = false) => new mongoose.Schema(Object.fromEntries(['en', 'ar'].map(language =>
  [language, { type: String, maxlength: max, required, default: required ? undefined : '' }])), { _id: false, strict: 'throw' });
const chart = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  name: { type: localized(200, true), required: true },
  alt: { type: localized(500), required: true },
  images: { en: { type: imageSchema, default: null }, ar: { type: imageSchema, default: null } },
  measurements: { type: new mongoose.Schema({
    unit: { type: String, enum: ['cm'], required: true },
    rows: { type: [new mongoose.Schema({
      size: { type: String, required: true, validate: value => [...value].length <= 30 },
      ...Object.fromEntries(['chest', 'length', 'sleeve'].map(key => [key, { type: Number, required: true, min: 0.01, max: 1000 }])),
    }, { _id: false, strict: 'throw' })], required: true },
  }, { _id: false, strict: 'throw' }), default: null, validate: {
    validator(value) { try { normalizeMeasurements(value == null ? null : value.toObject()); return true; } catch { return false; } },
    message: 'Invalid measurement table.',
  } },
  isActive: { type: Boolean, required: true, default: false },
  version: { type: Number, required: true, default: 0, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
}, { timestamps: true, strict: 'throw' });
chart.index({ store: 1, isActive: 1, createdAt: -1, _id: -1 });
export const SizeChart = mongoose.model('SizeChart', chart);
export const SizeChartAudit = mongoose.model('SizeChartAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  chartId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], required: true },
}, { timestamps: true, strict: 'throw' }));
