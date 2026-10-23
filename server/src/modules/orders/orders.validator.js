import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';
import { orderStatuses } from './orders.model.js';

export const checkoutValidator = [
  ...[['customer.name', 100], ['address.governorate', 100], ['address.district', 100],
    ['address.building', 200], ['address.street', 200]].map(([field, max]) => body(field).isString().withMessage('INVALID_FIELD').bail().trim()
    .isLength({ min: 1, max }).withMessage('INVALID_FIELD')),
  body('customer.email').isString().withMessage('INVALID_FIELD').bail().trim().toLowerCase()
    .isLength({ max: 254 }).withMessage('INVALID_FIELD').bail().isEmail().withMessage('INVALID_FIELD'),
  body('customer.phone').isString().withMessage('INVALID_FIELD').bail().trim().customSanitizer(normalizePhone).custom(validPhone).withMessage('INVALID_FIELD'),
  body('address.governorateCode').isString().withMessage('INVALID_FIELD').bail().trim().toLowerCase()
    .isLength({ min: 1, max: 100 }).withMessage('INVALID_FIELD').bail().matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).withMessage('INVALID_FIELD'),
  ...[['address.floor', 50], ['address.apartment', 50], ['address.details', 1000]].map(([field, max]) =>
    body(field).optional().isString().withMessage('INVALID_FIELD').bail().trim().isLength({ max }).withMessage('INVALID_FIELD')),
  body('paymentMethod').isIn(['cod', 'instapay']).withMessage('INVALID_FIELD'),
  body('couponCode').optional().isString().withMessage('INVALID_FIELD').bail().trim().toUpperCase()
    .matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/).withMessage('INVALID_FIELD'),
  validateRequest,
];
export const placeOrderValidator = [body('checkoutId').isMongoId().withMessage('INVALID_FIELD'),
  body('proofId').optional().isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const orderIdValidator = [param('orderId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const checkoutIdValidator = [param('checkoutId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const orderListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('status').optional().isIn(orderStatuses).withMessage('INVALID_FIELD'), validateRequest,
];
export const orderStatusValidator = [param('orderId').isMongoId().withMessage('INVALID_FIELD'),
  body('status').isIn(orderStatuses).withMessage('INVALID_FIELD'),
  body('expectedStatus').isIn(orderStatuses).withMessage('INVALID_FIELD'), validateRequest];
export const orderSettingsValidator = [body('receivingAccount').custom(value => value === null || (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 200))
  .withMessage('INVALID_FIELD').bail().customSanitizer(value => value === null ? null : value.trim()), validateRequest];
