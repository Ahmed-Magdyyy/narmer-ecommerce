import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createProductsController } from './products.controller.js';
import { createProductValidator, updateProductValidator, productIdValidator, productListValidator,
  publicProductListValidator, productFacetsValidator } from './products.validator.js';

export function createProductsRouter(products) {
  const router = Router();
  const controller = createProductsController(products);
  router.get('/', publicProductListValidator, controller.browse);
  router.get('/facets', productFacetsValidator, controller.facets);
  router.get('/:productId', productIdValidator, controller.publicItem);
  return router;
}
export function createStaffProductsRouter(products, authenticate) {
  const router = Router();
  const controller = createProductsController(products);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', productListValidator, controller.list);
  router.get('/:productId', productIdValidator, controller.item);
  router.post('/', createProductValidator, controller.create);
  router.patch('/:productId', updateProductValidator, controller.update);
  router.delete('/:productId', requireRoles('superAdmin'), productIdValidator, controller.remove);
  return router;
}
