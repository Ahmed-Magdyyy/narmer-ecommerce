import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createCategoriesController } from './categories.controller.js';
import { categoryIdValidator, createCategoryValidator, updateCategoryValidator, categoryListValidator } from './categories.validator.js';

export function createCategoriesRouter(categories) {
  const router = Router();
  const controller = createCategoriesController(categories);
  router.get('/', controller.browse);
  router.get('/:categoryId', categoryIdValidator, controller.publicItem);
  return router;
}
export function createStaffCategoriesRouter(categories, authenticate) {
  const router = Router();
  const controller = createCategoriesController(categories);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', categoryListValidator, controller.list);
  router.get('/tree', controller.tree);
  router.get('/:categoryId', categoryIdValidator, controller.item);
  router.post('/', createCategoryValidator, controller.create);
  router.patch('/:categoryId', updateCategoryValidator, controller.update);
  router.delete('/:categoryId', requireRoles('superAdmin'), categoryIdValidator, controller.remove);
  return router;
}
