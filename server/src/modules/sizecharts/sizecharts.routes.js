import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createCatalogImageUpload } from '../../shared/middleware/catalog-image-upload.js';
import { createSizechartsController } from './sizecharts.controller.js';
import { chartIdValidator, chartListValidator, createChartValidator, updateChartValidator, uploadChartValidator } from './sizecharts.validator.js';

export function createStaffSizechartsRouter(charts, authenticate) {
  const router = Router(), controller = createSizechartsController(charts);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', chartListValidator, controller.list);
  router.post('/', createChartValidator, controller.create);
  router.get('/:chartId', chartIdValidator, controller.item);
  router.patch('/:chartId', updateChartValidator, controller.update);
  router.delete('/:chartId', requireRoles('superAdmin'), chartIdValidator, controller.remove);
  router.post('/:chartId/images/:language', ...createCatalogImageUpload(uploadChartValidator), controller.upload);
  return router;
}
