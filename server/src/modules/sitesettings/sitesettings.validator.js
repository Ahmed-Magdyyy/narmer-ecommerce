import { body } from 'express-validator';
import { AppError } from '../../shared/errors/app-error.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const allowed = ['version', 'phone', 'email', 'address', 'mapUrl', 'social', 'seo'];
const nullableString = value => value === null || typeof value === 'string';
export const updateSettingsValidator = [
  (req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => !allowed.includes(key))) return next(new AppError(422, 'VALIDATION_ERROR'));
    next();
  },
  body('version').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD'),
  body('phone').optional().custom(nullableString).withMessage('INVALID_FIELD'),
  body('email').optional().custom(nullableString).withMessage('INVALID_FIELD').bail()
    .if(value => value !== null).trim().isLength({ max: 254 }).withMessage('INVALID_FIELD').bail()
    .isEmail().withMessage('INVALID_FIELD').toLowerCase(),
  body('mapUrl').optional().custom(nullableString).withMessage('INVALID_FIELD'),
  ...['address', 'social', 'seo'].map(key => body(key).optional().isObject({ strict: true }).withMessage('INVALID_FIELD')),
  validateRequest,
];
