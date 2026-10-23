import { sendSuccess } from '../../shared/utils/response.js';

export function createHomepageController(homepage) {
  return {
    async publicItem(req, res) { sendSuccess(res, { data: await homepage.getPublic(req.context.store, req.context.locale) }); },
    async item(req, res) { sendSuccess(res, { data: await homepage.getStaff(req.context.store, req.auth) }); },
    async update(req, res) { sendSuccess(res, { data: await homepage.update(req.context.store, req.auth, req.validated.body) }); },
    async upload(req, res) { sendSuccess(res, { status: 201, data: await homepage.upload(req.context.store, req.auth,
      req.validated.params.slotKey, req.validated.params.device, req.body, req.get('Content-Type')) }); },
  };
}
