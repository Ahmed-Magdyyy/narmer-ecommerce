import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors/app-error.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { createOrdersController } from './orders.controller.js';
import { checkoutValidator, checkoutIdValidator, placeOrderValidator, orderIdValidator, orderListValidator, orderStatusValidator, orderSettingsValidator } from './orders.validator.js';

const privateResponses = (req,res,next) => { res.set('Cache-Control','no-store'); next(); };
// shortcut: rate limits are per process; use a shared store when running multiple API instances.
const limit = (windowMs,count) => rateLimit({ windowMs,limit:count,standardHeaders:'draft-8',legacyHeaders:false,
  handler:(req,res,next) => next(new AppError(429,'TOO_MANY_REQUESTS')) });

export function createCheckoutRouter(orders) {
  const router=Router(),controller=createOrdersController(orders);
  router.use(privateResponses);
  router.post('/',checkoutValidator,controller.preview);
  router.post('/orders',placeOrderValidator,controller.place);
  router.post('/:checkoutId/proof',limit(60*60*1000,20),checkoutIdValidator,
    (req,res,next) => req.is(['image/jpeg','image/png','image/webp']) ? next() : next(new AppError(415,'IMAGE_TYPE_UNSUPPORTED')),
    raw({ type:['image/jpeg','image/png','image/webp'],limit:'5mb',inflate:false }),controller.upload);
  return router;
}
export function createOrdersRouter(orders,authenticate) {
  const router=Router(),controller=createOrdersController(orders);
  router.use(privateResponses);
  const trackingLimit=limit(15*60*1000,100);
  router.get('/tracking/:orderId',trackingLimit,orderIdValidator,controller.track);
  router.get('/tracking/:orderId/proof',trackingLimit,orderIdValidator,controller.trackingProof);
  router.use(authenticate,requireRoles('user'));
  router.get('/',orderListValidator,controller.listCustomer);
  router.get('/:orderId',orderIdValidator,controller.customer);
  router.get('/:orderId/proof',orderIdValidator,controller.customerProof);
  return router;
}
export function createStaffOrdersRouter(orders,authenticate) {
  const router=Router(),controller=createOrdersController(orders);
  router.use(privateResponses,authenticate,requireRoles('superAdmin','admin','moderator'));
  router.get('/settings',requireRoles('superAdmin','admin'),controller.settings);
  router.patch('/settings',requireRoles('superAdmin','admin'),orderSettingsValidator,controller.updateSettings);
  router.get('/',orderListValidator,controller.listStaff);
  router.get('/:orderId',orderIdValidator,controller.staff);
  router.get('/:orderId/proof',orderIdValidator,controller.staffProof);
  router.patch('/:orderId/status',orderStatusValidator,controller.status);
  return router;
}
