import { query } from 'express-validator';
import { AppError } from '../../shared/errors/app-error.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';

export const reportValidator = performance => [
  (req, res, next) => {
    const allowed = ['from', 'to', 'timezone', 'interval', ...(performance ? ['page', 'limit', 'rankBy'] : [])];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) return next(new AppError(422, 'VALIDATION_ERROR'));
    next();
  },
  ...['from', 'to'].map(key => query(key).isString().bail().isISO8601({ strict: true, strictSeparator: true })
    .bail().custom(value => /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))).withMessage('INVALID_FIELD')),
  query('timezone').optional().isIn(['Africa/Cairo']).withMessage('INVALID_FIELD'),
  query('interval').optional().isIn(['day', 'week', 'month']).withMessage('INVALID_FIELD'),
  ...(performance ? [
    query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('INVALID_FIELD').toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('INVALID_FIELD').toInt(),
    query('rankBy').optional().isIn(['units', 'merchandiseAmount']).withMessage('INVALID_FIELD'),
  ] : []),
  validateRequest,
];
