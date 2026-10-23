import { body } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

export const cartItemValidator = [
  body('productId').isMongoId().withMessage('INVALID_FIELD').toLowerCase(),
  body('variantId').optional({ values: 'null' }).isMongoId().withMessage('INVALID_FIELD').toLowerCase(),
  body('quantity').custom(value => Number.isSafeInteger(value) && value >= 0 && value <= 10000).withMessage('INVALID_FIELD'),
  validateRequest,
];
