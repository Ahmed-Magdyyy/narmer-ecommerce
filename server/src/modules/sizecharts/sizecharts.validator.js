import { body, param, query } from 'express-validator';
import { AppError } from '../../shared/errors/app-error.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';
import { normalizeMeasurements } from './sizecharts.measurements.js';

const chartId = () => param('chartId').isMongoId().withMessage('INVALID_FIELD').toLowerCase();
const localized = (key, max, required = false) => [
  body(key).optional(!required).custom(value => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).every(language => ['en', 'ar'].includes(language))).withMessage('INVALID_FIELD'),
  ...['en', 'ar'].map(language => {
    const rule = body(`${key}.${language}`).isString().withMessage('INVALID_FIELD').bail().trim()
      .isLength({ min: key === 'name' ? 1 : 0, max }).withMessage('INVALID_FIELD');
    return required ? rule : rule.optional();
  }),
];
const editable = patch => (req, res, next) => {
  const allowed = patch ? ['version', 'name', 'isActive', 'imageIds', 'alt', 'measurements'] : ['name', 'isActive', 'measurements'];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some(key => !allowed.includes(key))) return next(new AppError(422, 'VALIDATION_ERROR'));
  next();
};
const measurements = [
  (req, res, next) => {
    try { if (req.body && Object.hasOwn(req.body, 'measurements')) req.body.measurements = normalizeMeasurements(req.body.measurements); next(); }
    catch (error) { next(error); }
  },
  body('measurements').optional().custom(() => true),
];
export const chartIdValidator = [chartId(), validateRequest];
export const chartListValidator = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
  query('isActive').optional().custom(value => value === 'true' || value === 'false').withMessage('INVALID_FIELD').bail().toBoolean(),
  validateRequest,
];
export const createChartValidator = [editable(false), ...measurements, ...localized('name', 200, true),
  body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'), validateRequest];
export const updateChartValidator = [editable(true), ...measurements, chartId(),
  body('version').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('INVALID_FIELD'),
  ...localized('name', 200), ...localized('alt', 500),
  body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('INVALID_FIELD'),
  body('imageIds').optional().custom(value => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).every(language => ['en', 'ar'].includes(language))).withMessage('INVALID_FIELD'),
  ...['en', 'ar'].map(language => body(`imageIds.${language}`).optional()
    .custom(value => value === null || typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)).withMessage('INVALID_FIELD')),
  validateRequest,
];
export const uploadChartValidator = [chartId(), param('language').isIn(['en', 'ar']).withMessage('INVALID_FIELD'), validateRequest];
