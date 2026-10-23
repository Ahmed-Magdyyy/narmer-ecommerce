import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createCatalogImageUpload } from '../../shared/middleware/catalog-image-upload.js';
import { createHomepageController } from './homepage.controller.js';
import { updateHomepageValidator, uploadHomepageValidator } from './homepage.validator.js';

const noCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
export function createHomepageRouter(homepage) {
  const router = Router(); router.get('/', noCache, createHomepageController(homepage).publicItem); return router;
}
export function createStaffHomepageRouter(homepage, authenticate) {
  const router = Router(), controller = createHomepageController(homepage);
  router.use(noCache, authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', controller.item);
  router.patch('/', updateHomepageValidator, controller.update);
  router.post('/media/:slotKey/:device', ...createCatalogImageUpload(uploadHomepageValidator), controller.upload);
  return router;
}
