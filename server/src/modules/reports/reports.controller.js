import { sendSuccess } from '../../shared/utils/response.js';

export function createReportsController(reports) {
  return {
    async overview(req, res) { sendSuccess(res, { data: await reports.overview(req.context.store, req.auth, req.validated.query, req.context.locale) }); },
    async finance(req, res) { sendSuccess(res, { data: await reports.finance(req.context.store, req.auth, req.validated.query) }); },
    async performance(req, res) { sendSuccess(res, { data: await reports.performance(req.context.store, req.auth, req.validated.query, req.context.locale) }); },
  };
}
