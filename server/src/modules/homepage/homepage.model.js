import mongoose from 'mongoose';

const image = new mongoose.Schema({ id: { type: String, required: true }, url: { type: String, required: true },
  width: { type: Number, required: true }, height: { type: Number, required: true } }, { _id: false, strict: 'throw' });
const slot = new mongoose.Schema({ key: { type: String, required: true },
  desktopImage: { type: image, default: null }, mobileImage: { type: image, default: null },
  alt: { en: { type: String, maxlength: 500, default: '' }, ar: { type: String, maxlength: 500, default: '' } },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  _id: { type: String, enum: ['b2c', 'b2b'], required: true },
  version: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
  slots: { type: [slot], required: true },
  newArrivals: { productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] } },
  sale: { productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] } },
}, { timestamps: true, strict: 'throw' });
export const Homepage = mongoose.model('Homepage', schema);
export const HomepageAudit = mongoose.model('HomepageAudit', new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true }, actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true }, fields: { type: [String], required: true },
}, { timestamps: true, strict: 'throw' }));
