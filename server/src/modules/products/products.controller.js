import { sendSuccess } from '../../shared/utils/response.js';

export function createProductsController(products) {
  return {
    async browse(req, res) { sendSuccess(res, { data: await products.browse(req.context.store, req.validated.query, req.context.locale) }); },
    async facets(req, res) { sendSuccess(res, { data: await products.facets(req.context.store, req.validated.query, req.context.locale) }); },
    async publicItem(req, res) { sendSuccess(res, { data: await products.getPublic(req.context.store, req.validated.params.productId, req.context.locale) }); },
    async list(req, res) { sendSuccess(res, { data: await products.list(req.context.store, req.auth, req.validated.query) }); },
    async item(req, res) { sendSuccess(res, { data: await products.getStaff(req.context.store, req.auth, req.validated.params.productId) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await products.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await products.update(req.context.store, req.auth, req.validated.params.productId, req.validated.body) }); },
    async remove(req, res) {
      await products.remove(req.context.store, req.auth, req.validated.params.productId);
      sendSuccess(res);
    },
  };
}
