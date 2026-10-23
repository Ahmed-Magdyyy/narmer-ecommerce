import { Router } from 'express';
import { requireRoles } from '../auth/auth.middleware.js';
import { createNotificationsController } from './notifications.controller.js';
import { notificationIdValidator, notificationListValidator } from './notifications.validator.js';

export function createStaffNotificationsRouter(notifications, authenticate) {
  const router = Router(), controller = createNotificationsController(notifications);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, authenticate, requireRoles('superAdmin', 'admin', 'moderator'));
  router.get('/', notificationListValidator, controller.list);
  router.get('/unread-count', controller.count);
  router.patch('/:notificationId/read', notificationIdValidator, controller.read);
  return router;
}
