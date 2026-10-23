import { sendSuccess } from '../../shared/utils/response.js';

export function createShippingController(shipping) {
  return {
    async browse(req, res) { sendSuccess(res, { data: await shipping.browse(req.context.store, req.validated.query, req.context.locale) }); },
    async quote(req, res) { sendSuccess(res, { data: await shipping.resolve(req.context.store, req.validated.query.governorateCode, { locale: req.context.locale }) }); },
    async list(req, res) { sendSuccess(res, { data: await shipping.list(req.context.store, req.auth, req.validated.query) }); },
    async item(req, res) { sendSuccess(res, { data: await shipping.getStaff(req.context.store, req.auth, req.validated.params.feeId) }); },
    async defaultItem(req, res) { sendSuccess(res, { data: await shipping.getDefault(req.context.store, req.auth) }); },
    async defaultUpdate(req, res) { sendSuccess(res, { data: await shipping.setDefault(req.context.store, req.auth, req.validated.body) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await shipping.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await shipping.update(req.context.store, req.auth, req.validated.params.feeId, req.validated.body) }); },
    async remove(req, res) { await shipping.remove(req.context.store, req.auth, req.validated.params.feeId); sendSuccess(res); },
  };
}
