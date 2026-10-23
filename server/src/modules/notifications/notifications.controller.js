import { sendSuccess } from '../../shared/utils/response.js';

export function createNotificationsController(notifications) {
  return {
    async list(req, res) { sendSuccess(res, { data: await notifications.list(req.context.store, req.auth, req.validated.query, req.context.locale) }); },
    async count(req, res) { sendSuccess(res, { data: await notifications.unreadCount(req.context.store, req.auth) }); },
    async read(req, res) { sendSuccess(res, { data: await notifications.markRead(req.context.store, req.auth, req.validated.params.notificationId, req.context.locale) }); },
  };
}
