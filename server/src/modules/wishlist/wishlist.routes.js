import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors/app-error.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { createWishlistController } from './wishlist.controller.js';
import { wishlistProductValidator } from './wishlist.validator.js';

export function createWishlistRouter(wishlist, authenticate) {
  const router = Router();
  const controller = createWishlistController(wishlist);
  router.use(authenticate, requireRoles('user'));
  // shortcut: IP limits are per process; use a shared store if the API runs in multiple instances.
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS')) }));
  router.get('/', controller.get);
  router.put('/items/:productId', wishlistProductValidator, controller.add);
  router.delete('/items/:productId', wishlistProductValidator, controller.remove);
  router.delete('/', controller.clear);
  return router;
}
