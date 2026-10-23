import { body, param } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { formTypes } from './forms.definitions.js';

const type = () => param('formType').isIn(formTypes).withMessage('INVALID_FIELD');
export const formTypeValidator = [type(), validateRequest];
export const updateFormValidator = [
  type(),
  body('version').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD'),
  body('title').optional().isObject({ strict: true }).withMessage('INVALID_FIELD'),
  body('helpText').optional().isObject({ strict: true }).withMessage('INVALID_FIELD'),
  body('fields').optional().isArray({ max: 40 }).withMessage('INVALID_FIELD'),
  body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
  ...['fixedFields', 'type', 'store', 'supportedFieldTypes'].map(key =>
    body(key).optional().custom(() => false).withMessage('INVALID_FIELD')),
  validateRequest,
];
