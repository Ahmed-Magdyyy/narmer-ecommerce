import { param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

export const notificationIdValidator = [param('notificationId').isMongoId().withMessage('INVALID_FIELD').toLowerCase(), validateRequest];
export const notificationListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('unreadOnly').optional().custom(value => value === 'true' || value === 'false').withMessage('INVALID_FIELD').customSanitizer(value => value === 'true'),
  validateRequest,
];
