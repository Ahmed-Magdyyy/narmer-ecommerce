import { param } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

export const uploadImageValidator = [
  param('kind').isIn(['product', 'category']).withMessage('INVALID_FIELD'),
  param('targetId').isMongoId().withMessage('INVALID_FIELD'), validateRequest,
];
