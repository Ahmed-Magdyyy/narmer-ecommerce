import { createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/app-error.js';

// shortcut: counters are process-local for the confirmed single-process deployment; share storage before scaling out.
const options = {
  standardHeaders: 'draft-8', legacyHeaders: false,
  handler(req, res, next) { res.set('Cache-Control', 'no-store'); next(new AppError(429, 'TOO_MANY_REQUESTS')); },
};
const accountKey = req => `${req.auth.store}:${req.auth.userId}`;
const accountLimit = (windowMs, limit, identifier) => rateLimit({ ...options, windowMs, limit, identifier, keyGenerator: accountKey });
const apply = (middleware, req, res) => new Promise((resolve, reject) => {
  middleware(req, res, error => error ? reject(error) : resolve());
});

export const createApiIpLimiter = () => rateLimit({ ...options, windowMs: 60000, limit: 240, identifier: 'api-ip' });

export function createAuthenticatedLimits() {
  const general = accountLimit(60000, 120, 'account');
  const reports = accountLimit(60000, 30, 'reports-account');
  const password = accountLimit(900000, 10, 'password-account');
  const cart = accountLimit(900000, 150, 'cart-account');
  const wishlist = accountLimit(900000, 150, 'wishlist-account');
  const media = accountLimit(900000, 60, 'media-account');
  const proof = accountLimit(3600000, 20, 'proof-account');
  const leadImages = accountLimit(900000, 30, 'lead-images-account');
  return async (req, res) => {
    await apply(general, req, res);
    const path = req.originalUrl.split('?')[0];
    if (/^\/api\/v1\/b2[bc]\/auth\/change-password\/?$/i.test(path)) await apply(password, req, res);
    if (/^\/api\/v1\/admin\/b2c\/reports(?:\/|$)/i.test(path)) await apply(reports, req, res);
    if (/^\/api\/v1\/b2c\/cart(?:\/|$)/i.test(path)) await apply(cart, req, res);
    if (/^\/api\/v1\/b2c\/wishlist(?:\/|$)/i.test(path)) await apply(wishlist, req, res);
    if (/^\/api\/v1\/admin\/b2[bc]\/media(?:\/|$)/i.test(path)) await apply(media, req, res);
    if (/^\/api\/v1\/admin\/b2c\/size-charts\/[^/]+\/images\/[^/]+\/?$/i.test(path)) await apply(media, req, res);
    if (/^\/api\/v1\/admin\/b2[bc]\/homepage\/media\/[^/]+\/[^/]+\/?$/i.test(path)) await apply(media, req, res);
    if (/^\/api\/v1\/b2c\/cart\/checkout\/[^/]+\/proof\/?$/i.test(path)) await apply(proof, req, res);
    if (/^\/api\/v1\/b2b\/leads\/drafts\/[^/]+\/images\/?$/i.test(path)) await apply(leadImages, req, res);
  };
}

export const createLoginIdentityLimiter = () => rateLimit({
  ...options, windowMs: 900000, limit: 10, identifier: 'login-identity', skipSuccessfulRequests: true,
  keyGenerator: req => createHash('sha256').update(`${req.context.store}:${req.validated.body.email}`).digest('hex'),
});
