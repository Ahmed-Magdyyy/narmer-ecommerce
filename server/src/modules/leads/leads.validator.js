import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { formTypes } from '../forms/forms.definitions.js';

const fieldId = name => param(name).isMongoId().withMessage('INVALID_FIELD').toLowerCase();
export const draftIdValidator = [fieldId('draftId'), validateRequest];
export const leadIdValidator = [fieldId('leadId'), validateRequest];
export const leadImageValidator = [fieldId('leadId'), fieldId('imageId'), validateRequest];
export const prepareLeadValidator = [body('formType').isIn(formTypes).withMessage('INVALID_FIELD'), validateRequest];
export const submitLeadValidator = [
  body('draftId').isMongoId().withMessage('INVALID_FIELD').toLowerCase(),
  body('formVersion').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD'),
  body('contact').isObject({ strict: true }).withMessage('INVALID_FIELD'),
  body('contact.email').optional({ values: 'falsy' }).isString().withMessage('INVALID_FIELD').bail().trim()
    .isLength({ max: 254 }).withMessage('INVALID_FIELD').bail().isEmail().withMessage('INVALID_FIELD').toLowerCase(),
  body('answers').optional().isObject({ strict: true }).withMessage('INVALID_FIELD'),
  body('imageIds').optional().isArray({ max: 5 }).withMessage('INVALID_FIELD'),
  body('imageIds.*').isMongoId().withMessage('INVALID_FIELD'),
  body('wholesaleRequests').optional().isArray({ max: 10 }).withMessage('INVALID_FIELD'),
  ...['userId', 'store', 'status', 'contactedBy', 'formSnapshot', 'trackingToken', 'imageUrls'].map(key => body(key).optional().custom(() => false).withMessage('INVALID_FIELD')),
  validateRequest,
];
export const leadListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('formType').optional().isIn(formTypes).withMessage('INVALID_FIELD'),
  query('status').optional().isIn(['submitted', 'contacted']).withMessage('INVALID_FIELD'), validateRequest,
];
