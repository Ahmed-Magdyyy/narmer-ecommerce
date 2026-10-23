import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors/app-error.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { createLeadsController } from './leads.controller.js';
import { draftIdValidator, leadIdValidator, leadImageValidator, prepareLeadValidator, submitLeadValidator, leadListValidator } from './leads.validator.js';

const privateResponses = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const draftToken = (req, res, next) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(req.get('X-Lead-Draft-Token') ?? '')) throw new AppError(401, 'UNAUTHORIZED'); next();
};
// shortcut: IP limits are per process; use a shared store when deploying multiple instances.
const limit = count => rateLimit({ windowMs: 15 * 60 * 1000, limit: count, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS')) });
export function createLeadsRouter(leads, authenticate) {
  const router = Router(), controller = createLeadsController(leads);
  router.use(privateResponses);
  const optionalCustomer = async (req, res, next) => {
    if (req.get('Authorization') !== undefined) { await authenticate(req, res, () => {}); if (req.auth.role !== 'user') throw new AppError(403, 'FORBIDDEN'); }
    next();
  };
  router.post('/drafts', limit(20), optionalCustomer, prepareLeadValidator, controller.prepare);
  router.get('/drafts/:draftId', limit(100), optionalCustomer, draftToken, draftIdValidator, controller.draft);
  router.post('/drafts/:draftId/images', limit(30), optionalCustomer, draftToken, draftIdValidator,
    (req, res, next) => req.is(['image/jpeg', 'image/png', 'image/webp']) ? next() : next(new AppError(415, 'IMAGE_TYPE_UNSUPPORTED')),
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb', inflate: false }), controller.upload);
  router.post('/', limit(20), optionalCustomer, draftToken, submitLeadValidator, controller.submit);
  router.get('/tracking/:leadId', limit(100), leadIdValidator, controller.track);
  router.use(authenticate, requireRoles('user'));
  router.get('/', leadListValidator, controller.list);
  router.get('/:leadId', leadIdValidator, controller.item);
  return router;
}
export function createStaffLeadsRouter(leads, authenticate) {
  const router = Router(), controller = createLeadsController(leads);
  router.use(privateResponses, authenticate, requireRoles('superAdmin', 'admin', 'moderator'));
  router.get('/', leadListValidator, controller.staffList);
  router.get('/:leadId', leadIdValidator, controller.staffItem);
  router.get('/:leadId/images/:imageId', leadImageValidator, controller.image);
  router.patch('/:leadId/contacted', leadIdValidator, controller.contacted);
  return router;
}
