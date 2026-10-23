import { raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/app-error.js';

export function createCatalogImageUpload(validators) {
  // shortcut: this IP counter is process-local; use shared counters before adding workers/servers.
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => { res.set('Cache-Control', 'no-store'); next(new AppError(429, 'TOO_MANY_REQUESTS')); } });
  return [limit, ...validators,
    (req, res, next) => req.is(['image/jpeg', 'image/png', 'image/webp']) ? next() : next(new AppError(415, 'IMAGE_TYPE_UNSUPPORTED')),
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb', inflate: false })];
}
