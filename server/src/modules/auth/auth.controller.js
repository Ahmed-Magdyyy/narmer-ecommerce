import { sendSuccess } from '../../shared/utils/response.js';
import { refreshCookieName, refreshCookieOptions } from './auth.middleware.js';

export function createAuthController(auth, config) {
  function sendSession(req, res, result) {
    res.cookie(refreshCookieName(req.context.store), result.refreshToken, {
      ...refreshCookieOptions(config, req.context.store), expires: result.refreshExpiresAt,
    });
    sendSuccess(res, { data: { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn } });
  }
  return {
    async register(req, res) {
      await auth.register(req.context.store, req.validated.body, req.context.locale);
      sendSuccess(res, { status: 201, code: 'OTP_REQUESTED' });
    },
    async resend(req, res) {
      await auth.resend(req.context.store, req.validated.body.email, req.context.locale);
      sendSuccess(res, { code: 'OTP_REQUESTED' });
    },
    async verifyEmail(req, res) {
      const { email, otp } = req.validated.body;
      await auth.verifyEmail(req.context.store, email, otp);
      sendSuccess(res, { code: 'EMAIL_CONFIRMED' });
    },
    async login(req, res) {
      const { email, password } = req.validated.body;
      sendSession(req, res, await auth.login(req.context.store, email, password));
    },
    async refresh(req, res) {
      sendSession(req, res, await auth.refresh(req.context.store, req.refreshToken));
    },
    async logout(req, res) {
      await auth.logout(req.context.store, req.auth);
      res.clearCookie(refreshCookieName(req.context.store), refreshCookieOptions(config, req.context.store));
      sendSuccess(res, { code: 'LOGGED_OUT' });
    },
    async forgotPassword(req, res) {
      await auth.forgotPassword(req.context.store, req.validated.body.email, req.context.locale);
      sendSuccess(res, { code: 'OTP_REQUESTED' });
    },
    async resetPassword(req, res) {
      const { email, otp, password } = req.validated.body;
      await auth.resetPassword(req.context.store, email, otp, password);
      res.clearCookie(refreshCookieName(req.context.store), refreshCookieOptions(config, req.context.store));
      sendSuccess(res, { code: 'PASSWORD_RESET' });
    },
    async handoverSuperAdmin(req, res) {
      const data = await auth.handoverSuperAdmin(req.context.store, req.auth, req.validated.body.userId);
      res.clearCookie(refreshCookieName(req.context.store), refreshCookieOptions(config, req.context.store));
      sendSuccess(res, { code: 'SUPER_ADMIN_CHANGED', data });
    },
  };
}
