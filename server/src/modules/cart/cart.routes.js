import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors/app-error.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { guestCartLifetimeMs } from './cart.service.js';
import { createCartController } from './cart.controller.js';
import { cartItemValidator } from './cart.validator.js';

export function createCartRouter(cart, authenticate, config, couponPreviewRouter, checkoutRouter) {
  const router = Router();
  const controller = createCartController(cart);
  const cookieName = 'narmer_cart_b2c';
  const cookieOptions = { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/api/v1/b2c/cart' };
  // shortcut: IP limits are per process; use a shared store if the API runs in multiple instances.
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS')) }));
  router.use(async (req, res, next) => {
    const cookies = (req.get('Cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    if (cookies.length > 1) throw new AppError(401, 'UNAUTHORIZED');
    const token = cookies[0]?.slice(cookieName.length + 1);
    if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(401, 'UNAUTHORIZED');
    req.guestCartToken = token;
    req.cartCookieOptions = cookieOptions;
    if (req.get('Authorization') !== undefined) {
      await authenticate(req, res, () => {});
      if (req.auth.role !== 'user') throw new AppError(403, 'FORBIDDEN');
      req.cartOwner = { identity: req.auth };
    } else {
      // Origin checks protect every cookie-authenticated write, including a new guest cart.
      if (req.method !== 'GET' && !config.corsOrigins.includes(req.get('Origin'))) throw new AppError(403, 'FORBIDDEN');
      req.guestCartToken = token || randomBytes(32).toString('base64url');
      req.cartOwner = { guestToken: req.guestCartToken };
      res.cookie(cookieName, req.guestCartToken, { ...cookieOptions, maxAge: guestCartLifetimeMs });
    }
    if (req.path === '/merge' && !config.corsOrigins.includes(req.get('Origin'))) throw new AppError(403, 'FORBIDDEN');
    next();
  });
  router.get('/', controller.get);
  router.put('/items', cartItemValidator, controller.setItem);
  router.delete('/', controller.clear);
  router.post('/merge', requireRoles('user'), controller.merge);
  router.use('/coupon-preview', couponPreviewRouter);
  router.use('/checkout', checkoutRouter);
  return router;
}
