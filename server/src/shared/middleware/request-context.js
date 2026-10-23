import { randomUUID } from 'node:crypto';

function selectLocale(req, fallback) {
  const explicit = req.get('X-Language')?.toLowerCase();
  if (['en', 'ar'].includes(explicit)) return explicit;
  if (!req.get('Accept-Language')) return fallback;
  const preferred = req.acceptsLanguages(fallback, fallback === 'en' ? 'ar' : 'en');
  return preferred || fallback;
}

export function requestContext(defaultLocale, logger) {
  return (req, res, next) => {
    const requestId = randomUUID();
    const locale = selectLocale(req, defaultLocale);
    req.context = Object.freeze({ requestId, locale });
    res.locals.requestId = requestId;
    res.locals.locale = locale;
    res.set('X-Request-Id', requestId);
    res.set('Content-Language', locale);
    res.vary('X-Language');
    res.vary('Accept-Language');
    const started = performance.now();
    res.on('finish', () => logger.info({
      event: 'http_request', requestId, method: req.method,
      route: req.route?.path ?? 'unmatched', status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    }));
    next();
  };
}
