import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const money = path => body(path).custom(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000).withMessage('INVALID_FIELD');
const sku = path => body(path).optional().custom(value => value === null || typeof value === 'string').withMessage('INVALID_FIELD').bail()
  .customSanitizer(value => value?.trim().toUpperCase() || null)
  .custom(value => value === null || /^[A-Z0-9][A-Z0-9._/-]{0,99}$/.test(value)).withMessage('INVALID_FIELD');
const text = (path, max, required = false) => {
  const rule = body(path).isString().withMessage('INVALID_FIELD').bail().trim()
    .isLength({ min: required ? 1 : 0, max }).withMessage('INVALID_FIELD');
  return required ? rule : rule.optional();
};
function fields(patch) {
  const nameRules = ['ar', 'en'].map(locale => {
    const rule = text(`name.${locale}`, 200, true);
    return patch ? rule.optional() : rule;
  });
  const category = body('categoryId').isMongoId().withMessage('INVALID_FIELD');
  const slug = body('slug').isString().withMessage('INVALID_FIELD').bail().trim().isLength({ max: 150 })
    .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).withMessage('INVALID_FIELD');
  return [
    ...nameRules, ...['ar', 'en'].map(locale => text(`description.${locale}`, 10000)),
    patch ? category.optional() : category, patch ? slug.optional() : slug,
    body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
    body('sizeChartId').optional().custom(value => value === null || typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)).withMessage('INVALID_FIELD'),
    body('imageIds').optional().isArray({ max: 10 }).withMessage('INVALID_FIELD'),
    body('imageIds.*').isMongoId().withMessage('INVALID_FIELD'),
    sku('sku'), money('price').optional(), money('stock').optional(),
    body('discountedPrice').optional().custom(value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1000000000)).withMessage('INVALID_FIELD'),
    body('options').optional().isArray({ max: 5 }).withMessage('INVALID_FIELD'),
    body('options.*.key').matches(/^[a-z][a-z0-9_-]{0,39}$/).withMessage('INVALID_FIELD'),
    ...['ar', 'en'].map(locale => text(`options.*.name.${locale}`, 200, true)),
    body('options.*.values').isArray({ min: 1, max: 50 }).withMessage('INVALID_FIELD'),
    body('options.*.values.*.key').matches(/^[a-z0-9][a-z0-9_-]{0,39}$/).withMessage('INVALID_FIELD'),
    ...['ar', 'en'].map(locale => text(`options.*.values.*.name.${locale}`, 200, true)),
    body('variants').optional().isArray({ min: 1, max: 100 }).withMessage('INVALID_FIELD'),
    body('variants.*.id').optional().isMongoId().withMessage('INVALID_FIELD'), sku('variants.*.sku'),
    money('variants.*.price'), money('variants.*.stock').optional(),
    body('variants.*.discountedPrice').optional().custom(value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1000000000)).withMessage('INVALID_FIELD'),
    body('variants.*.values').isObject({ strict: true }).withMessage('INVALID_FIELD'),
    body('variants.*.imageIds').optional().isArray({ max: 10 }).withMessage('INVALID_FIELD'),
    body('variants.*.imageIds.*').isMongoId().withMessage('INVALID_FIELD'),
  ];
}
export const createProductValidator = [body('type').isIn(['simple', 'variant']).withMessage('INVALID_FIELD'), ...fields(false), validateRequest];
export const updateProductValidator = [param('productId').isMongoId().withMessage('INVALID_FIELD'), money('version'),
  body('type').optional().isIn(['simple', 'variant']).withMessage('INVALID_FIELD'), ...fields(true), validateRequest];
export const productIdValidator = [param('productId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
export const productListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('categoryId').optional().isMongoId().withMessage('INVALID_FIELD'),
  query('type').optional().isIn(['simple', 'variant']).withMessage('INVALID_FIELD'),
  query('isActive').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(),
  validateRequest,
];

const browseFilters = () => [
  ...['minPrice', 'maxPrice'].map(key => query(key).optional()
    .custom(value => typeof value === 'string' && /^\d+$/.test(value)
      && Number.isSafeInteger(Number(value)) && Number(value) <= 1000000000).withMessage('INVALID_FIELD')
    .bail().custom((value, { req }) => key !== 'maxPrice' || req.query.minPrice === undefined
      || Number(value) >= Number(req.query.minPrice)).withMessage('INVALID_FIELD').bail().toInt()),
  ...['size', 'color'].map(key => query(key).optional()
    .custom(value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)).withMessage('INVALID_FIELD')),
  query('saleOnly').optional().custom(value => value === 'true' || value === 'false')
    .withMessage('INVALID_FIELD').bail().toBoolean(),
];
export const publicProductListValidator = [...productListValidator.slice(0, -1), ...browseFilters(),
  query('sort').optional().custom(value => typeof value === 'string'
    && ['newest', 'price-asc', 'price-desc'].includes(value)).withMessage('INVALID_FIELD'), validateRequest];
export const productFacetsValidator = [
  query('categoryId').optional().isMongoId().withMessage('INVALID_FIELD'),
  query('type').optional().isIn(['simple', 'variant']).withMessage('INVALID_FIELD'),
  ...browseFilters(), validateRequest,
];
