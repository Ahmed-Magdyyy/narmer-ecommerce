import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';

const code = () => body('code').isString().withMessage('INVALID_FIELD').bail().trim().toUpperCase()
  .matches(/^[A-Z0-9][A-Z0-9_-]{2,39}$/).withMessage('INVALID_FIELD');
const date = path => body(path).optional().custom(value => value === null || typeof value === 'string').withMessage('INVALID_FIELD').bail()
  .if((value) => value !== null).matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/).withMessage('INVALID_FIELD').bail()
  .isISO8601({ strict: true, strictSeparator: true }).withMessage('INVALID_FIELD');
const fields = patch => {
  const required = rule => patch ? rule.optional() : rule;
  return [required(code()), ...['ar', 'en'].map(locale => required(body(`name.${locale}`).isString().withMessage('INVALID_FIELD').bail().trim().isLength({ min: 1, max: 150 }).withMessage('INVALID_FIELD'))),
    required(body('targetType').isIn(['all', 'products', 'category']).withMessage('INVALID_FIELD')),
    body('productIds').optional().isArray({ max: 100 }).withMessage('INVALID_FIELD'), body('productIds.*').isMongoId().withMessage('INVALID_FIELD'),
    body('categoryId').optional().custom(value => value === null || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))).withMessage('INVALID_FIELD'),
    required(body('discountType').isIn(['percentage', 'fixed']).withMessage('INVALID_FIELD')),
    required(body('discountValue').custom(value => Number.isSafeInteger(value) && value >= 1 && value <= 1000000000).withMessage('INVALID_FIELD')),
    body('minimumSpend').optional().custom(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000000000).withMessage('INVALID_FIELD'),
    ...['maxUses', 'maxUsesPerPerson'].map(path => body(path).optional().custom(value => value === null || (Number.isSafeInteger(value) && value >= 1 && value <= 1000000000)).withMessage('INVALID_FIELD')),
    date('startsAt'), date('endsAt'), body('isEnabled').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
  ];
};
export const createCouponValidator = [...fields(false), validateRequest];
export const updateCouponValidator = [param('couponId').isMongoId().withMessage('INVALID_FIELD'), ...fields(true), validateRequest];
export const couponIdValidator = [param('couponId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const couponListValidator = [query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('isEnabled').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(),
  query('targetType').optional().isIn(['all', 'products', 'category']).withMessage('INVALID_FIELD'), validateRequest];
export const couponPreviewValidator = [code(), body('phone').isString().withMessage('INVALID_FIELD').bail().trim()
  .customSanitizer(normalizePhone).custom(validPhone).withMessage('INVALID_FIELD'), validateRequest];
