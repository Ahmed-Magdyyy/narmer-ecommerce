import { sendSuccess } from '../../shared/utils/response.js';

export function createSizechartsController(charts) {
  return {
    async list(req, res) { sendSuccess(res, { data: await charts.list(req.context.store, req.auth, req.validated.query) }); },
    async item(req, res) { sendSuccess(res, { data: await charts.getStaff(req.context.store, req.auth, req.validated.params.chartId) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await charts.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await charts.update(req.context.store, req.auth, req.validated.params.chartId, req.validated.body) }); },
    async remove(req, res) {
      await charts.remove(req.context.store, req.auth, req.validated.params.chartId); sendSuccess(res);
    },
    async upload(req, res) {
      sendSuccess(res, { status: 201, data: await charts.upload(req.context.store, req.auth,
        req.validated.params.chartId, req.validated.params.language, req.body, req.get('Content-Type')) });
    },
  };
}
