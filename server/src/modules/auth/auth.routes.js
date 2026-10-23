import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors/app-error.js';
import { createLoginIdentityLimiter } from '../../shared/middleware/rate-limits.js';
import { cookieRefresh, requireRoles } from './auth.middleware.js';
import { createAuthController } from './auth.controller.js';
import { registerValidator, emailValidator, verifyEmailValidator, loginValidator, resetPasswordValidator, changePasswordValidator, handoverValidator } from './auth.validator.js';

export function createAuthRouter(auth, authenticate, config) {
  const router = Router();
  const controller = createAuthController(auth, config);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const options = { windowMs: 15 * 60 * 1000, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS')) };
  // shortcut: IP limits are per process; use a shared store if the API runs in multiple instances.
  const sending = rateLimit({ ...options, limit: 10 });
  const attempts = rateLimit({ ...options, limit: 30 });
  router.post('/register', sending, registerValidator, controller.register);
  router.post('/resend-otp', sending, emailValidator, controller.resend);
  router.post('/verify-email', attempts, verifyEmailValidator, controller.verifyEmail);
  router.post('/login', attempts, loginValidator, createLoginIdentityLimiter(), controller.login);
  router.post('/refresh', attempts, cookieRefresh(config), controller.refresh);
  router.post('/logout', attempts, authenticate, controller.logout);
  router.post('/forgot-password', sending, emailValidator, controller.forgotPassword);
  router.post('/reset-password', attempts, resetPasswordValidator, controller.resetPassword);
  router.post('/change-password', attempts, authenticate, changePasswordValidator, controller.changePassword);
  return router;
}

export function createAdminAuthRouter(auth, authenticate, config) {
  const router = Router();
  const controller = createAuthController(auth, config);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/super-admin/handover', authenticate, requireRoles('superAdmin'), handoverValidator, controller.handoverSuperAdmin);
  return router;
}
