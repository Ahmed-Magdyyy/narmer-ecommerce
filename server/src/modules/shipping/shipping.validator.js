import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const fee = path => body(path).custom(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000).withMessage('INVALID_FIELD');
const code = rule => rule.isString().withMessage('INVALID_FIELD').bail().trim().toLowerCase()
  .isLength({ min: 1, max: 100 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).withMessage('INVALID_FIELD');
const names = patch => ['ar', 'en'].map(locale => {
  const rule = body(`name.${locale}`).isString().withMessage('INVALID_FIELD').bail().trim()
    .isLength({ min: 1, max: 150 }).withMessage('INVALID_FIELD');
  return patch ? rule.optional() : rule;
});
export const shippingIdValidator = [param('feeId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const createShippingValidator = [code(body('governorateCode')), ...names(false), fee('fee'), validateRequest];
export const updateShippingValidator = [param('feeId').isMongoId().withMessage('INVALID_FIELD'),
  code(body('governorateCode')).optional(), ...names(true), fee('fee').optional(), validateRequest];
export const defaultShippingValidator = [fee('defaultFee'), validateRequest];
export const quoteShippingValidator = [code(query('governorateCode')), validateRequest];
export const shippingListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(), validateRequest,
];
