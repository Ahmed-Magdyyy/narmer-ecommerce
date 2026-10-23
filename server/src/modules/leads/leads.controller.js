import { sendSuccess } from '../../shared/utils/response.js';

export function createLeadsController(leads) {
  const token = req => req.get('X-Lead-Draft-Token');
  return {
    async prepare(req, res) { sendSuccess(res, { status: 201, data: await leads.prepare(req.context.store, req.auth, req.validated.body.formType) }); },
    async draft(req, res) { sendSuccess(res, { data: await leads.getDraft(req.context.store, req.auth, req.validated.params.draftId, token(req)) }); },
    async upload(req, res) { sendSuccess(res, { status: 201, data: await leads.upload(req.context.store, req.auth, req.validated.params.draftId, token(req), req.body, req.get('Content-Type')) }); },
    async submit(req, res) {
      const { created, ...data } = await leads.submit(req.context.store, req.auth, token(req), req.validated.body, req.context.locale);
      sendSuccess(res, { status: created ? 201 : 200, data });
    },
    async track(req, res) { sendSuccess(res, { data: await leads.track(req.context.store, req.validated.params.leadId, req.get('X-Lead-Token'), req.context.locale) }); },
    async list(req, res) { sendSuccess(res, { data: await leads.list(req.context.store, req.auth, req.validated.query, req.context.locale) }); },
    async item(req, res) { sendSuccess(res, { data: await leads.get(req.context.store, req.auth, req.validated.params.leadId, req.context.locale) }); },
    async staffList(req, res) { sendSuccess(res, { data: await leads.list(req.context.store, req.auth, req.validated.query, undefined, true) }); },
    async staffItem(req, res) { sendSuccess(res, { data: await leads.get(req.context.store, req.auth, req.validated.params.leadId, undefined, true) }); },
    async contacted(req, res) { sendSuccess(res, { data: await leads.contacted(req.context.store, req.auth, req.validated.params.leadId) }); },
    async image(req, res) {
      const bytes = await leads.readImage(req.context.store, req.auth, req.validated.params.leadId, req.validated.params.imageId);
      res.type('image/webp').set('X-Content-Type-Options', 'nosniff').send(bytes);
    },
  };
}
