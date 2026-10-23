import { AppError } from '../errors/app-error.js';
import { translate } from '../i18n/messages.js';

const bodyErrors = {
  __proto__: null,
  'entity.parse.failed': [400, 'INVALID_JSON'],
  'entity.too.large': [413, 'BODY_TOO_LARGE'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING'],
  'charset.unsupported': [415, 'UNSUPPORTED_ENCODING'],
};

export function errorHandler(logger) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof AppError;
    const [status, code] = known
      ? [error.status, error.code]
      : bodyErrors[error.type] ?? [500, 'INTERNAL_ERROR'];
    if (status >= 500) logger.error({
      event: 'request_error', requestId: res.locals.requestId, code,
      route: req.route?.path ?? 'unmatched',
    });
    const errors = known ? error.errors.map(item => ({
      ...item, message: translate(item.code, res.locals.locale),
    })) : [];
    res.status(status).json({
      success: false, code, message: translate(code, res.locals.locale), errors,
      requestId: res.locals.requestId,
    });
  };
}
