import mongoose from 'mongoose';

const store = { type: String, enum: ['b2c', 'b2b'], required: true, immutable: true };
const userId = { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true };

const challengeSchema = new mongoose.Schema({
  store, userId,
  purpose: { type: String, enum: ['verify-email', 'reset-password'], required: true, immutable: true },
  digest: { type: String, required: true },
  nonce: { type: String, required: true },
  authVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  lastSentAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
challengeSchema.index({ store: 1, userId: 1, purpose: 1 }, { unique: true });
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const sessionSchema = new mongoose.Schema({
  store, userId,
  authVersion: { type: Number, required: true },
  refreshDigest: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ store: 1, userId: 1 });

const assignmentSchema = new mongoose.Schema({ store,
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, strict: 'throw' });
assignmentSchema.index({ store: 1 }, { unique: true });

export const AuthChallenge = mongoose.model('AuthChallenge', challengeSchema);
export const AuthSession = mongoose.model('AuthSession', sessionSchema);
export const SuperAdminAssignment = mongoose.model('SuperAdminAssignment', assignmentSchema);
