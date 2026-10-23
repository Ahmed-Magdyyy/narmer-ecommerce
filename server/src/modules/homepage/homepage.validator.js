import { body, param } from 'express-validator';
import { AppError } from '../../shared/errors/app-error.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { homepageSlots } from './homepage.slots.js';

export const updateHomepageValidator = [
  (req, res, next) => {
    const keys = req.context.store === 'b2c' ? ['version', 'slots', 'newArrivals', 'sale'] : ['version', 'slots'];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => !keys.includes(key))) return next(new AppError(422, 'VALIDATION_ERROR'));
    next();
  },
  body('version').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD'),
  body('slots').optional().isArray({ min: 1, max: 7 }).withMessage('INVALID_FIELD'),
  ...['newArrivals', 'sale'].map(key => body(key).optional().isObject({ strict: true }).withMessage('INVALID_FIELD')),
  validateRequest,
];
export const uploadHomepageValidator = [
  param('slotKey').custom((key, { req }) => homepageSlots(req.context.store).some(slot => slot.key === key)).withMessage('INVALID_FIELD'),
  param('device').isIn(['desktop', 'mobile']).withMessage('INVALID_FIELD'), validateRequest,
];
