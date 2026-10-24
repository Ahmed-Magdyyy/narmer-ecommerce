import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { isOfferSlug, legacyOfferIdPattern } from './wholesale.slug.js';

const mongoId = () => param('resourceId').isMongoId().withMessage('INVALID_FIELD').toLowerCase();
const version = () => body('version').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD');
function fields(product, patch) {
  const required = rule => patch ? rule.optional() : rule;
  return [
    required(body('name').isObject({ strict: true }).withMessage('INVALID_FIELD')),
    body('description').optional().isObject({ strict: true }).withMessage('INVALID_FIELD'),
    body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
    ...(product ? [body('imageIds').optional().isArray({ max: 10 }).withMessage('INVALID_FIELD'),
      body('imageIds.*').isMongoId().withMessage('INVALID_FIELD')] : [
      required(body('sourceStore').isIn(['b2c', 'b2b']).withMessage('INVALID_FIELD')),
      required(body('productId').isMongoId().withMessage('INVALID_FIELD').toLowerCase()),
      required(body('composition').isArray({ min: 1, max: 100 }).withMessage('INVALID_FIELD')),
      ...(patch ? [body('slug').optional().isString().withMessage('INVALID_FIELD').bail().trim()
        .custom(isOfferSlug).withMessage('INVALID_FIELD')] : [body('slug').optional().custom(() => false).withMessage('INVALID_FIELD')]),
      body('slugAliases').optional().custom(() => false).withMessage('INVALID_FIELD'),
    ]),
    ...['price', 'stock', 'discountedPrice', 'sku', 'options', 'variants', 'categoryId', 'type',
      ...(product ? ['sourceStore', 'productId', 'composition'] : ['imageIds'])].map(key =>
      body(key).optional().custom(() => false).withMessage('INVALID_FIELD')),
  ];
}
export const wholesaleIdValidator = [mongoId(), validateRequest];
export const wholesaleOfferKeyValidator = [param('offerKey').isString().withMessage('INVALID_FIELD').bail()
  .isLength({ min: 1, max: 150 }).withMessage('INVALID_FIELD').bail()
  .toLowerCase().custom(value => isOfferSlug(value) || legacyOfferIdPattern.test(value)).withMessage('INVALID_FIELD'), validateRequest];
export const createWholesaleProductValidator = [...fields(true, false), validateRequest];
export const updateWholesaleProductValidator = [mongoId(), version(), ...fields(true, true), validateRequest];
export const createWholesaleOfferValidator = [...fields(false, false), validateRequest];
export const updateWholesaleOfferValidator = [mongoId(), version(), ...fields(false, true), validateRequest];
const paging = [query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('q').optional().isString().withMessage('INVALID_FIELD').bail().trim().isLength({ min: 1, max: 100 }).withMessage('INVALID_FIELD')];
export const wholesaleProductListValidator = [...paging,
  query('isActive').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(), validateRequest];
export const wholesaleOfferListValidator = [...paging,
  query('isActive').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(),
  query('sourceStore').optional().isIn(['b2c', 'b2b']).withMessage('INVALID_FIELD'),
  query('productId').optional().isMongoId().withMessage('INVALID_FIELD').toLowerCase(), validateRequest];
export const wholesaleB2cListValidator = [...paging,
  query('type').optional().isIn(['simple', 'variant']).withMessage('INVALID_FIELD'), validateRequest];
