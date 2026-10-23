import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createWholesaleController } from './wholesale.controller.js';
import { wholesaleIdValidator, wholesaleProductListValidator, wholesaleOfferListValidator, wholesaleB2cListValidator,
  createWholesaleProductValidator, updateWholesaleProductValidator, createWholesaleOfferValidator, updateWholesaleOfferValidator } from './wholesale.validator.js';

export function createWholesaleRouter(wholesale) {
  const router = Router(), controller = createWholesaleController(wholesale);
  router.get('/offers', wholesaleOfferListValidator, controller.browse);
  router.get('/offers/:resourceId', wholesaleIdValidator, controller.publicItem);
  return router;
}
export function createStaffWholesaleRouter(wholesale, authenticate) {
  const router = Router(), controller = createWholesaleController(wholesale);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/b2c-products', wholesaleB2cListValidator, controller.b2cProducts);
  router.get('/b2c-products/:resourceId', wholesaleIdValidator, controller.b2cProduct);
  router.get('/products', wholesaleProductListValidator, controller.products);
  router.post('/products', createWholesaleProductValidator, controller.createProduct);
  router.get('/products/:resourceId', wholesaleIdValidator, controller.product);
  router.patch('/products/:resourceId', updateWholesaleProductValidator, controller.updateProduct);
  router.delete('/products/:resourceId', requireRoles('superAdmin'), wholesaleIdValidator, controller.removeProduct);
  router.get('/offers', wholesaleOfferListValidator, controller.offers);
  router.post('/offers', createWholesaleOfferValidator, controller.createOffer);
  router.get('/offers/:resourceId', wholesaleIdValidator, controller.offer);
  router.patch('/offers/:resourceId', updateWholesaleOfferValidator, controller.updateOffer);
  router.delete('/offers/:resourceId', requireRoles('superAdmin'), wholesaleIdValidator, controller.removeOffer);
  return router;
}
