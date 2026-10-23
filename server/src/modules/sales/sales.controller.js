import { sendSuccess } from '../../shared/utils/response.js';

export function createSalesController(sales) {
  return {
    async list(req, res) { sendSuccess(res, { data: await sales.list(req.context.store, req.auth, req.validated.query) }); },
    async item(req, res) { sendSuccess(res, { data: await sales.getStaff(req.context.store, req.auth, req.validated.params.saleId) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await sales.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await sales.update(req.context.store, req.auth, req.validated.params.saleId, req.validated.body) }); },
    async remove(req, res) { await sales.remove(req.context.store, req.auth, req.validated.params.saleId); sendSuccess(res); },
  };
}
