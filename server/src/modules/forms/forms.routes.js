import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createFormsController } from './forms.controller.js';
import { formTypeValidator, updateFormValidator } from './forms.validator.js';

export function createFormsRouter(forms) {
  const router = Router();
  const controller = createFormsController(forms);
  router.get('/', controller.browse);
  router.get('/:formType', formTypeValidator, controller.publicItem);
  return router;
}
export function createStaffFormsRouter(forms, authenticate) {
  const router = Router();
  const controller = createFormsController(forms);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', controller.list);
  router.get('/:formType', formTypeValidator, controller.item);
  router.patch('/:formType', updateFormValidator, controller.update);
  return router;
}
