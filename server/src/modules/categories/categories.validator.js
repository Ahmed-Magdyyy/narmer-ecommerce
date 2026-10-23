import { body, param, query } from 'express-validator';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const id = () => param('categoryId').isMongoId().withMessage('INVALID_FIELD');
function fields(patch = false) {
  return [
    ...['ar', 'en'].map(locale => {
      const rule = body(`name.${locale}`).isString().withMessage('INVALID_FIELD').bail().trim()
        .isLength({ min: 1, max: 150 }).withMessage('INVALID_FIELD');
      return patch ? rule.optional() : rule;
    }),
    ...['ar', 'en'].map(locale => body(`description.${locale}`).optional().isString().withMessage('INVALID_FIELD').bail()
      .trim().isLength({ max: 2000 }).withMessage('INVALID_FIELD')),
    body('parentId').optional().custom(value => value === null || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))).withMessage('INVALID_FIELD'),
    (() => {
      const rule = body('slug').isString().withMessage('INVALID_FIELD').bail().trim()
        .isLength({ max: 150 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).withMessage('INVALID_FIELD');
      return patch ? rule.optional() : rule;
    })(),
    body('position').optional().isInt({ min: 0, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
    body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
    body('imageId').optional().custom(value => value === null || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))).withMessage('INVALID_FIELD'),
  ];
}
export const categoryIdValidator = [id(), validateRequest];
export const createCategoryValidator = [...fields(), validateRequest];
export const updateCategoryValidator = [id(), ...fields(true), validateRequest];
export const categoryListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('parentId').optional().custom(value => value === 'root' || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)))
    .withMessage('INVALID_FIELD').customSanitizer(value => value === 'root' ? null : value),
  query('isActive').optional().isIn(['true', 'false']).withMessage('INVALID_FIELD').toBoolean(),
  validateRequest,
];
