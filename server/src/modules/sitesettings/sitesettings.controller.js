import { sendSuccess } from '../../shared/utils/response.js';

export function createSitesettingsController(settings) {
  return {
    async publicItem(req, res) { sendSuccess(res, { data: await settings.getPublic(req.context.store, req.context.locale) }); },
    async item(req, res) { sendSuccess(res, { data: await settings.getStaff(req.context.store, req.auth) }); },
    async update(req, res) { sendSuccess(res, { data: await settings.update(req.context.store, req.auth, req.validated.body) }); },
  };
}
