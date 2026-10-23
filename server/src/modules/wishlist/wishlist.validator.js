import { param } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

export const wishlistProductValidator = [
  param('productId').isMongoId().withMessage('INVALID_FIELD').toLowerCase(), validateRequest,
];
