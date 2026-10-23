import { sendSuccess } from '../../shared/utils/response.js';

export function createFormsController(forms) {
  return {
    async browse(req, res) { sendSuccess(res, { data: await forms.browse(req.context.store, req.context.locale) }); },
    async publicItem(req, res) { sendSuccess(res, { data: await forms.getPublic(req.context.store, req.validated.params.formType, req.context.locale) }); },
    async list(req, res) { sendSuccess(res, { data: await forms.list(req.context.store, req.auth) }); },
    async item(req, res) { sendSuccess(res, { data: await forms.getStaff(req.context.store, req.auth, req.validated.params.formType) }); },
    async update(req, res) { sendSuccess(res, { data: await forms.update(req.context.store, req.auth, req.validated.params.formType, req.validated.body) }); },
  };
}
