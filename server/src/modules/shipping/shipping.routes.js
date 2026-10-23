import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createShippingController } from './shipping.controller.js';
import { shippingIdValidator, shippingListValidator, createShippingValidator, updateShippingValidator,
  defaultShippingValidator, quoteShippingValidator } from './shipping.validator.js';

export function createShippingRouter(shipping) {
  const router = Router();
  const controller = createShippingController(shipping);
  router.get('/', shippingListValidator, controller.browse);
  router.get('/quote', quoteShippingValidator, controller.quote);
  return router;
}
export function createStaffShippingRouter(shipping, authenticate) {
  const router = Router();
  const controller = createShippingController(shipping);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', shippingListValidator, controller.list);
  router.get('/default', controller.defaultItem);
  router.patch('/default', defaultShippingValidator, controller.defaultUpdate);
  router.get('/:feeId', shippingIdValidator, controller.item);
  router.post('/', createShippingValidator, controller.create);
  router.patch('/:feeId', updateShippingValidator, controller.update);
  // Shipping overrides are the explicitly agreed exception to the admin deletion restriction.
  router.delete('/:feeId', shippingIdValidator, controller.remove);
  return router;
}
