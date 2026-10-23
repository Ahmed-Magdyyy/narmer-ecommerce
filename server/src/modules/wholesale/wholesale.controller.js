import { sendSuccess } from '../../shared/utils/response.js';

export function createWholesaleController(wholesale) {
  const input = req => [req.context.store, req.auth];
  const resource = req => req.validated.params.resourceId;
  return {
    async browse(req, res) { sendSuccess(res, { data: await wholesale.browse(req.context.store, req.validated.query, req.context.locale) }); },
    async publicItem(req, res) { sendSuccess(res, { data: await wholesale.getPublic(req.context.store, resource(req), req.context.locale) }); },
    async products(req, res) { sendSuccess(res, { data: await wholesale.listProducts(...input(req), req.validated.query) }); },
    async product(req, res) { sendSuccess(res, { data: await wholesale.getProduct(...input(req), resource(req)) }); },
    async createProduct(req, res) { sendSuccess(res, { status: 201, data: await wholesale.createProduct(...input(req), req.validated.body) }); },
    async updateProduct(req, res) { sendSuccess(res, { data: await wholesale.updateProduct(...input(req), resource(req), req.validated.body) }); },
    async removeProduct(req, res) { await wholesale.removeProduct(...input(req), resource(req)); sendSuccess(res); },
    async offers(req, res) { sendSuccess(res, { data: await wholesale.listOffers(...input(req), req.validated.query) }); },
    async offer(req, res) { sendSuccess(res, { data: await wholesale.getOffer(...input(req), resource(req)) }); },
    async createOffer(req, res) { sendSuccess(res, { status: 201, data: await wholesale.createOffer(...input(req), req.validated.body) }); },
    async updateOffer(req, res) { sendSuccess(res, { data: await wholesale.updateOffer(...input(req), resource(req), req.validated.body) }); },
    async removeOffer(req, res) { await wholesale.removeOffer(...input(req), resource(req)); sendSuccess(res); },
    async b2cProducts(req, res) { sendSuccess(res, { data: await wholesale.selectB2c(...input(req), req.validated.query) }); },
    async b2cProduct(req, res) { sendSuccess(res, { data: await wholesale.getB2c(...input(req), resource(req)) }); },
  };
}
