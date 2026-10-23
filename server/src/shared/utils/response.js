import { translate } from '../i18n/messages.js';

export function sendSuccess(res, { status = 200, code = 'OK', data = null } = {}) {
  return res.status(status).json({
    success: true, code, message: translate(code, res.locals.locale), data,
    requestId: res.locals.requestId,
  });
}
