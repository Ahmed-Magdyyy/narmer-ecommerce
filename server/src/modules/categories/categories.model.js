import mongoose from 'mongoose';
import { imageSchema } from '../../shared/infrastructure/media/image-schema.js';

const text = required => new mongoose.Schema({
  ar: { type: String, required, trim: true, maxlength: required ? 150 : 2000, default: required ? undefined : '' },
  en: { type: String, required, trim: true, maxlength: required ? 150 : 2000, default: required ? undefined : '' },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: text(true), required: true },
  description: { type: text(false), default: () => ({}) },
  slug: { type: String, required: true, maxlength: 150, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  position: { type: Number, default: 0, min: 0, max: 100000, validate: Number.isInteger },
  isActive: { type: Boolean, default: true },
  image: { type: imageSchema, default: null },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, slug: 1 }, { unique: true });
schema.index({ store: 1, parentId: 1, position: 1, _id: 1 });
export const Category = mongoose.model('Category', schema);

// Writing this shared document prevents write skew between changes to different nodes.
export const CategoryTree = mongoose.model('CategoryTree', new mongoose.Schema({
  _id: { type: String, enum: ['b2c'] }, revision: { type: Number, default: 0 },
}, { versionKey: false, strict: 'throw' }));

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });
audit.index({ store: 1, createdAt: -1 });
export const CategoryAudit = mongoose.model('CategoryAudit', audit);
