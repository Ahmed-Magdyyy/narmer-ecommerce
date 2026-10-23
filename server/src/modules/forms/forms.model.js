import mongoose from 'mongoose';
import { formTypes, fieldTypes } from './forms.definitions.js';

const bilingual = max => new mongoose.Schema({
  ar: { type: String, required: true, trim: true, maxlength: max },
  en: { type: String, required: true, trim: true, maxlength: max },
}, { _id: false, strict: 'throw' });
const label = bilingual(150);
const choice = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 40 },
  label: { type: label, required: true },
}, { _id: false, strict: 'throw' });
const field = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 40 },
  type: { type: String, enum: fieldTypes, required: true },
  label: { type: label, required: true },
  required: { type: Boolean, required: true },
  choices: { type: [choice], default: [], validate: value => value.length <= 50 },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true, immutable: true },
  type: { type: String, enum: formTypes, required: true, immutable: true },
  title: { type: label, required: true },
  helpText: { type: new mongoose.Schema({
    ar: { type: String, default: '', maxlength: 2000 }, en: { type: String, default: '', maxlength: 2000 },
  }, { _id: false, strict: 'throw' }), default: () => ({ ar: '', en: '' }) },
  fields: { type: [field], default: [], validate: value => value.length <= 40 },
  isActive: { type: Boolean, required: true, default: false },
  version: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  submissionRevision: { type: Number, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, type: 1 }, { unique: true });
export const FormDefinition = mongoose.model('FormDefinition', schema);

const audit = new mongoose.Schema({
  store: { type: String, enum: ['b2b'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  formType: { type: String, enum: formTypes, required: true },
  action: { type: String, enum: ['updated'], required: true },
  previousVersion: { type: Number, required: true, min: 0 },
  version: { type: Number, required: true, min: 1 },
  fields: { type: [String], required: true },
}, { timestamps: true, strict: 'throw' });
export const FormAudit = mongoose.model('FormAudit', audit);
