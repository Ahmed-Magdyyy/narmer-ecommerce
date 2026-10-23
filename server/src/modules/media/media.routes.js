import { Router } from 'express';
import { createCatalogImageUpload } from '../../shared/middleware/catalog-image-upload.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { createMediaController } from './media.controller.js';
import { uploadImageValidator } from './media.validator.js';

export function createMediaRouter(media, authenticate) {
  const router = Router();
  const controller = createMediaController(media);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.post('/:kind/:targetId', ...createCatalogImageUpload(uploadImageValidator), controller.upload);
  return router;
}
