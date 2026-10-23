import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createReportsController } from './reports.controller.js';
import { reportValidator } from './reports.validator.js';

export function createStaffReportsRouter(reports, authenticate) {
  const router = Router(), controller = createReportsController(reports);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/overview', reportValidator(false), controller.overview);
  router.get('/finance', reportValidator(false), controller.finance);
  router.get('/sales-performance', reportValidator(true), controller.performance);
  return router;
}
