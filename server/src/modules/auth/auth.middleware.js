import { AppError } from '../../shared/errors/app-error.js';
import { createAuthenticatedLimits } from '../../shared/middleware/rate-limits.js';

export function createAuthenticate(auth) {
  const limits = createAuthenticatedLimits();
  return async (req, res, next) => {
    const header = req.get('Authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_.-]{1,2048})$/i.exec(header);
    if (!match) throw new AppError(401, 'UNAUTHORIZED');
    req.auth = await auth.authenticate(req.context.store, match[1]);
    await limits(req, res);
    next();
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) throw new AppError(403, 'FORBIDDEN');
    next();
  };
}

export const refreshCookieName = store => `narmer_refresh_${store}`;
export const refreshCookieOptions = (config, store) => ({
  httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax',
  path: `/api/v1/${store}/auth`,
});

export function cookieRefresh(config) {
  return (req, res, next) => {
    // Cookie-authenticated requests require an explicitly allowed origin, including same-origin clients.
    if (!config.corsOrigins.includes(req.get('Origin'))) throw new AppError(403, 'FORBIDDEN');
    const prefix = `${refreshCookieName(req.context.store)}=`;
    const matches = (req.get('Cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix));
    if (matches.length !== 1) throw new AppError(401, 'UNAUTHORIZED');
    req.refreshToken = matches[0].slice(prefix.length);
    next();
  };
}
