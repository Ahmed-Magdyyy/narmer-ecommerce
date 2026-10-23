import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createSalesController } from './sales.controller.js';
import { saleIdValidator, saleListValidator, createSaleValidator, updateSaleValidator } from './sales.validator.js';

export function createStaffSalesRouter(sales, authenticate) {
  const router = Router();
  const controller = createSalesController(sales);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', saleListValidator, controller.list);
  router.get('/:saleId', saleIdValidator, controller.item);
  router.post('/', createSaleValidator, controller.create);
  router.patch('/:saleId', updateSaleValidator, controller.update);
  router.delete('/:saleId', requireRoles('superAdmin'), saleIdValidator, controller.remove);
  return router;
}
