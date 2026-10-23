import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 100 },
  governorate: { type: String, required: true, trim: true, maxlength: 100 },
  district: { type: String, default: '', trim: true, maxlength: 100 },
  building: { type: String, required: true, trim: true, maxlength: 200 },
  street: { type: String, required: true, trim: true, maxlength: 200 },
  floor: { type: String, default: '', trim: true, maxlength: 50 },
  apartment: { type: String, default: '', trim: true, maxlength: 50 },
  details: { type: String, default: '', trim: true, maxlength: 1000 },
  contactPhone: { type: String, default: null, maxlength: 25 },
}, { strict: 'throw' });

const schema = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, immutable: true },
  phone: { type: String, required: true, maxlength: 25 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['superAdmin', 'admin', 'moderator', 'user'], default: 'user' },
  status: { type: String, enum: ['active', 'blocked', 'deleted'], default: 'active' },
  deletedAt: { type: Date, default: null },
  addresses: { type: [addressSchema], default: [] },
  emailVerifiedAt: { type: Date, default: null },
  authVersion: { type: Number, default: 0, min: 0, select: false },
}, { timestamps: true, strict: 'throw' });
schema.index({ store: 1, email: 1 }, { unique: true });
schema.index({ store: 1, createdAt: -1, _id: -1 });

export const User = mongoose.model('User', schema);

const auditState = new mongoose.Schema({ role: String, status: String, holderId: mongoose.Schema.Types.ObjectId }, { _id: false });
const auditSchema = new mongoose.Schema({
  store: { type: String, enum: ['b2c', 'b2b'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['account.updated', 'account.deleted', 'superAdmin.provisioned', 'superAdmin.handover'], required: true },
  fields: { type: [String], default: [] },
  before: auditState,
  after: auditState,
}, { timestamps: true, strict: 'throw' });
auditSchema.index({ store: 1, createdAt: -1 });
export const UserAudit = mongoose.model('UserAudit', auditSchema);
