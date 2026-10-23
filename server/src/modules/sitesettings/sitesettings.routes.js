import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createSitesettingsController } from './sitesettings.controller.js';
import { updateSettingsValidator } from './sitesettings.validator.js';

const noCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
export function createSitesettingsRouter(settings) {
  const router = Router();
  router.get('/', noCache, createSitesettingsController(settings).publicItem);
  return router;
}
export function createStaffSitesettingsRouter(settings, authenticate) {
  const router = Router(), controller = createSitesettingsController(settings);
  router.use(noCache, authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', controller.item);
  router.patch('/', updateSettingsValidator, controller.update);
  return router;
}
