import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';

export const nameField = () => body('name').isString().withMessage('INVALID_FIELD').bail()
  .trim().isLength({ min: 1, max: 100 }).withMessage('INVALID_FIELD');
export const phoneField = () => body('phone').isString().withMessage('INVALID_FIELD').bail()
  .trim().customSanitizer(normalizePhone).custom(validPhone).withMessage('INVALID_FIELD');

export const updateProfileValidator = [
  nameField().optional(), phoneField().optional(),
  validateRequest,
];

const addressRules = (patch = false) => [
  ...[['label', 100], ['governorate', 100], ['building', 200], ['street', 200]].map(([key, max]) => {
    const rule = body(key).isString().withMessage('INVALID_FIELD').bail().trim()
      .isLength({ min: 1, max }).withMessage('INVALID_FIELD');
    return patch ? rule.optional() : rule;
  }),
  ...[['district', 100], ['floor', 50], ['apartment', 50], ['details', 1000]].map(([key, max]) =>
    body(key).optional().isString().withMessage('INVALID_FIELD').bail().trim().isLength({ max }).withMessage('INVALID_FIELD')),
  body('contactPhone').optional().custom(value => value === null || typeof value === 'string').withMessage('INVALID_FIELD').bail()
    .customSanitizer(value => value?.trim() ? normalizePhone(value.trim()) : null)
    .custom(value => value === null || validPhone(value)).withMessage('INVALID_FIELD'),
];
const addressId = () => param('addressId').isMongoId().withMessage('INVALID_FIELD');
export const addAddressValidator = [...addressRules(), validateRequest];
export const updateAddressValidator = [addressId(), ...addressRules(true), validateRequest];
export const addressIdValidator = [addressId(), validateRequest];
export const accountId = () => param('userId').isMongoId().withMessage('INVALID_FIELD');
export const accountIdValidator = [accountId(), validateRequest];
export const accountListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('role').optional().isIn(['superAdmin', 'admin', 'moderator', 'user']).withMessage('INVALID_FIELD'),
  query('status').optional().isIn(['active', 'blocked', 'deleted']).withMessage('INVALID_FIELD'),
  validateRequest,
];
export const updateAccountValidator = [
  accountId(), nameField().optional(), phoneField().optional(),
  body('role').optional().isIn(['admin', 'moderator', 'user']).withMessage('INVALID_FIELD'),
  body('status').optional().isIn(['active', 'blocked']).withMessage('INVALID_FIELD'),
  validateRequest,
];
