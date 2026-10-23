import { sendSuccess } from '../../shared/utils/response.js';

export function createCategoriesController(categories) {
  return {
    async browse(req, res) { sendSuccess(res, { data: await categories.browse(req.context.store, req.context.locale) }); },
    async publicItem(req, res) { sendSuccess(res, { data: await categories.getPublic(req.context.store, req.validated.params.categoryId, req.context.locale) }); },
    async list(req, res) { sendSuccess(res, { data: await categories.list(req.context.store, req.auth, req.validated.query) }); },
    async tree(req, res) { sendSuccess(res, { data: await categories.staffTree(req.context.store, req.auth) }); },
    async item(req, res) { sendSuccess(res, { data: await categories.getStaff(req.context.store, req.auth, req.validated.params.categoryId) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await categories.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await categories.update(req.context.store, req.auth, req.validated.params.categoryId, req.validated.body) }); },
    async remove(req, res) {
      await categories.remove(req.context.store, req.auth, req.validated.params.categoryId);
      sendSuccess(res);
    },
  };
}
