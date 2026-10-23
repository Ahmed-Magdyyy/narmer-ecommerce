import { sendSuccess } from '../../shared/utils/response.js';

export function createCouponsController(coupons) {
  return {
    async list(req, res) { sendSuccess(res, { data: await coupons.list(req.context.store, req.auth, req.validated.query) }); },
    async item(req, res) { sendSuccess(res, { data: await coupons.getStaff(req.context.store, req.auth, req.validated.params.couponId) }); },
    async create(req, res) { sendSuccess(res, { status: 201, data: await coupons.create(req.context.store, req.auth, req.validated.body) }); },
    async update(req, res) { sendSuccess(res, { data: await coupons.update(req.context.store, req.auth, req.validated.params.couponId, req.validated.body) }); },
    async remove(req, res) { await coupons.remove(req.context.store, req.auth, req.validated.params.couponId); sendSuccess(res); },
    async preview(req, res) { sendSuccess(res, { data: await coupons.preview(req.context.store, req.cartOwner,
      req.validated.body.code, req.validated.body.phone, req.context.locale) }); },
  };
}
