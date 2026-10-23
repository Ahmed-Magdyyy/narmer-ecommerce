import { matchedData, validationResult } from 'express-validator';
import { AppError } from '../errors/app-error.js';

export function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array({ onlyFirstError: true }).map(error => ({
      field: error.path ?? null,
      location: error.location ?? null,
      code: typeof error.msg === 'string' && /^[A-Z][A-Z_]*$/.test(error.msg)
        ? error.msg : 'INVALID_FIELD',
    }));
    return next(new AppError(422, 'VALIDATION_ERROR', errors));
  }
  req.validated = {
    body: matchedData(req, { locations: ['body'] }),
    params: matchedData(req, { locations: ['params'] }),
    query: matchedData(req, { locations: ['query'] }),
  };
  next();
}
