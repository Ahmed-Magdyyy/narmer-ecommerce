import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../../shared/errors/app-error.js';

export const authPolicy = Object.freeze({
  accessSeconds: 15 * 60, sessionMs: 7 * 24 * 60 * 60 * 1000,
  otpMs: 10 * 60 * 1000, resendMs: 60 * 1000, otpAttempts: 5, passwordRounds: 12,
});

export const makeOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const makeNonce = () => randomBytes(16).toString('hex');
export const makeRefresh = id => `${id}.${randomBytes(32).toString('base64url')}`;
export const refreshDigest = token => createHash('sha256').update(token).digest('hex');
export const otpDigest = (secret, challenge, otp) => createHmac('sha256', secret)
  .update([challenge.store, challenge.userId, challenge.purpose, challenge.authVersion, challenge.nonce, otp].join(':'))
  .digest('hex');

export function equalDigest(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashPassword(password) {
  if (bcrypt.truncates(password)) throw new AppError(422, 'PASSWORD_TOO_LONG');
  return bcrypt.hash(password, authPolicy.passwordRounds);
}
export const comparePassword = (password, hash) => bcrypt.compare(password, hash);

export function createTokens(config) {
  return {
    sign(user, session) {
      return jwt.sign({ store: user.store, version: user.authVersion, sid: String(session._id), type: 'access' },
        config.jwtSecret, { algorithm: 'HS256', issuer: 'narmer-server', audience: `narmer:${user.store}`,
          subject: String(user._id), expiresIn: authPolicy.accessSeconds });
    },
    verify(token, store) {
      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, {
          algorithms: ['HS256'], issuer: 'narmer-server', audience: `narmer:${store}`,
        });
      } catch { throw new AppError(401, 'UNAUTHORIZED'); }
      if (payload.type !== 'access' || payload.store !== store || !Number.isInteger(payload.version)
        || !Number.isInteger(payload.exp) || !/^[a-f0-9]{24}$/.test(payload.sub ?? '')
        || !/^[a-f0-9]{24}$/.test(payload.sid ?? '')) throw new AppError(401, 'UNAUTHORIZED');
      return payload;
    },
  };
}
