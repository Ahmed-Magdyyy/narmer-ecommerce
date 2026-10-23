import mongoose from 'mongoose';
import { imageSchema } from '../../shared/infrastructure/media/image-schema.js';

const bilingual = required => new mongoose.Schema({
  ar: { type: String, required, trim: true, maxlength: required ? 200 : 10000, default: required ? undefined : '' },
  en: { type: String, required, trim: true, maxlength: required ? 200 : 10000, default: required ? undefined : '' },
}, { _id: false, strict: 'throw' });
const integer = (required = false, fallback) => ({ type: Number, required, default: fallback, min: 0, max: 1000000000, validate: Number.isSafeInteger });
const variant = new mongoose.Schema({
  sku: { type: String, default: null, trim: true, uppercase: true, maxlength: 100 },
  price: integer(true), discountedPrice: { ...integer(), default: null, validate: value => value === null || Number.isSafeInteger(value) },
  stock: integer(true, 0),
  values: { type: Map, of: String, required: true },
  images: { type: [imageSchema], default: [] },
}, { strict: 'throw' });
const choice = new mongoose.Schema({ key: { type: String, required: true }, name: { type: bilingual(true), required: true } }, { _id: false, strict: 'throw' });
const option = new mongoose.Schema({ key: { type: String, required: true }, name: { type: bilingual(true), required: true },
  values: { type: [choice], required: true } }, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true, immutable: true },
  type: { type: String, enum: ['simple', 'variant'], required: true, immutable: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, required: true },
  sizeChartId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: bilingual(true), required: true },
  description: { type: bilingual(false), default: () => ({}) },
  slug: { type: String, required: true, maxlength: 150, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  isActive: { type: Boolean, default: true },
  sku: { type: String, default: null, trim: true, uppercase: true, maxlength: 100 },
  price: { ...integer(), default: null, validate: value => value === null || Number.isSafeInteger(value) },
  discountedPrice: { ...integer(), default: null, validate: value => value === null || Number.isSafeInteger(value) },
  stock: { ...integer(), default: null, validate: value => value === null || Number.isSafeInteger(value) },
  options: { type: [option], default: [] },
  variants: { type: [variant], default: [] },
  images: { type: [imageSchema], default: [] },
  // One multikey index shares the optional SKU namespace across simple and variant fields.
  skuKeys: { type: [String], default: [], select: false },
  version: integer(true, 0),
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, slug: 1 }, { unique: true });
schema.index({ store: 1, skuKeys: 1 }, { unique: true, partialFilterExpression: { 'skuKeys.0': { $exists: true } } });
schema.index({ store: 1, categoryId: 1, isActive: 1, createdAt: -1, _id: -1 });
schema.index({ store: 1, sizeChartId: 1 });
export const Product = mongoose.model('Product', schema);

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2c'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });
audit.index({ store: 1, createdAt: -1 });
export const ProductAudit = mongoose.model('ProductAudit', audit);
