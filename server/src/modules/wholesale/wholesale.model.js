import mongoose from 'mongoose';
import { imageSchema } from '../../shared/infrastructure/media/image-schema.js';
import { isOfferSlug } from './wholesale.slug.js';

const bilingual = (max, required) => new mongoose.Schema({
  ar: { type: String, required, maxlength: max, default: required ? undefined : '' },
  en: { type: String, required, maxlength: max, default: required ? undefined : '' },
}, { _id: false, strict: 'throw' });
const common = {
  store: { type: String, enum: ['b2b'], required: true, immutable: true },
  name: { type: bilingual(200, true), required: true },
  description: { type: bilingual(10000, false), default: () => ({ ar: '', en: '' }) },
  isActive: { type: Boolean, required: true },
  version: { type: Number, min: 0, required: true, default: 0, validate: Number.isSafeInteger },
};
const product = new mongoose.Schema({ ...common,
  images: { type: [imageSchema], default: [], validate: images => images.length <= 10 },
}, { timestamps: true, strict: 'throw' });
product.index({ store: 1, isActive: 1 });
export const WholesaleProduct = mongoose.model('WholesaleProduct', product);
const line = new mongoose.Schema({
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, required: true, min: 1, max: 10000, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });
const offer = new mongoose.Schema({ ...common,
  slug: { type: String, required: true, validate: isOfferSlug },
  slugAliases: { type: [String], default: [], validate: value => value.every(isOfferSlug) && new Set(value).size === value.length },
  sourceStore: { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  composition: { type: [line], required: true, validate: value => value.length >= 1 && value.length <= 100 },
}, { timestamps: true, strict: 'throw' });
offer.index({ store: 1, sourceStore: 1, productId: 1 });
offer.index({ store: 1, isActive: 1 });
export const WholesaleOffer = mongoose.model('WholesaleOffer', offer);
// Keys outlive offers so an old public URL can never identify a different offer.
export const WholesaleOfferKey = mongoose.model('WholesaleOfferKey', new mongoose.Schema({
  _id: { type: String, required: true, validate: isOfferSlug },
  store: { type: String, enum: ['b2b'], required: true, immutable: true },
  offerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
}, { strict: 'throw' }));
export const WholesaleGuard = mongoose.model('WholesaleGuard', new mongoose.Schema({
  _id: { type: String, enum: ['b2b'] }, revision: { type: Number, default: 0 },
}, { strict: 'throw' }));
export const WholesaleAudit = mongoose.model('WholesaleAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  resource: { type: String, enum: ['product', 'offer'], required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  fields: { type: [String], required: true },
}, { timestamps: true, strict: 'throw' }));
