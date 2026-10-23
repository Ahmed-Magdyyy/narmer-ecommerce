import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const names = patch => ['ar', 'en'].map(locale => {
  const rule = body(`name.${locale}`).isString().withMessage('INVALID_FIELD').bail().trim()
    .isLength({ min: 1, max: 150 }).withMessage('INVALID_FIELD');
  return patch ? rule.optional() : rule;
});
const date = path => body(path).isString().withMessage('INVALID_FIELD').bail()
  .matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/).withMessage('INVALID_FIELD').bail()
  .isISO8601({ strict: true, strictSeparator: true }).withMessage('INVALID_FIELD');
const fields = patch => {
  const required = rule => patch ? rule.optional() : rule;
  return [...names(patch),
    required(body('targetType').isIn(['products', 'category']).withMessage('INVALID_FIELD')),
    body('productIds').optional().isArray({ max: 100 }).withMessage('INVALID_FIELD'),
    body('productIds.*').isMongoId().withMessage('INVALID_FIELD'),
    body('categoryId').optional().custom(value => value === null || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))).withMessage('INVALID_FIELD'),
    required(body('discountType').isIn(['percentage', 'fixed']).withMessage('INVALID_FIELD')),
    required(body('discountValue').custom(value => Number.isSafeInteger(value) && value >= 1 && value <= 1000000000).withMessage('INVALID_FIELD')),
    required(date('startsAt')), required(date('endsAt')),
    body('isEnabled').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
  ];
};
export const saleIdValidator = [param('saleId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const createSaleValidator = [...fields(false), validateRequest];
export const updateSaleValidator = [param('saleId').isMongoId().withMessage('INVALID_FIELD'), ...fields(true), validateRequest];
export const saleListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('isEnabled').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(),
  query('targetType').optional().isIn(['products', 'category']).withMessage('INVALID_FIELD'), validateRequest,
];
