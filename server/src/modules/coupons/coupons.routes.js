import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createCouponsController } from './coupons.controller.js';
import { couponIdValidator, couponListValidator, createCouponValidator, updateCouponValidator, couponPreviewValidator } from './coupons.validator.js';

export function createCouponPreviewRouter(coupons) {
  const router = Router();
  router.post('/', couponPreviewValidator, createCouponsController(coupons).preview);
  return router;
}

export function createStaffCouponsRouter(coupons, authenticate) {
  const router = Router(), controller = createCouponsController(coupons);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', couponListValidator, controller.list);
  router.get('/:couponId', couponIdValidator, controller.item);
  router.post('/', createCouponValidator, controller.create);
  router.patch('/:couponId', updateCouponValidator, controller.update);
  router.delete('/:couponId', requireRoles('superAdmin'), couponIdValidator, controller.remove);
  return router;
}
