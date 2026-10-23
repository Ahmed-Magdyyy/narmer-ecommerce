import { sendSuccess } from '../../shared/utils/response.js';

export function createOrdersController(orders) {
  const reply = (req, res, data, status = 200) => sendSuccess(res, { status, data });
  const proof = (res, bytes) => res.type('image/webp').set('X-Content-Type-Options', 'nosniff').send(bytes);
  return {
    async preview(req,res) { reply(req,res,await orders.preview(req.context.store,req.cartOwner,req.validated.body,req.context.locale)); },
    async upload(req,res) { reply(req,res,await orders.uploadProof(req.context.store,req.cartOwner,req.validated.params.checkoutId,req.body,req.get('Content-Type')),201); },
    async place(req,res) {
      const { created,...data } = await orders.place(req.context.store,req.cartOwner,req.validated.body,req.context.locale);
      reply(req,res,data,created ? 201 : 200);
    },
    async listCustomer(req,res) { reply(req,res,await orders.list(req.context.store,req.auth,req.validated.query,req.context.locale)); },
    async listStaff(req,res) { reply(req,res,await orders.list(req.context.store,req.auth,req.validated.query,req.context.locale,true)); },
    async customer(req,res) { reply(req,res,await orders.getCustomer(req.context.store,req.auth,req.validated.params.orderId,req.context.locale)); },
    async staff(req,res) { reply(req,res,await orders.getStaff(req.context.store,req.auth,req.validated.params.orderId,req.context.locale)); },
    async track(req,res) { reply(req,res,await orders.track(req.context.store,req.validated.params.orderId,req.get('X-Order-Token'),req.context.locale)); },
    async customerProof(req,res) { proof(res,await orders.readCustomerProof(req.context.store,req.auth,req.validated.params.orderId)); },
    async staffProof(req,res) { proof(res,await orders.readStaffProof(req.context.store,req.auth,req.validated.params.orderId)); },
    async trackingProof(req,res) { proof(res,await orders.readTrackingProof(req.context.store,req.validated.params.orderId,req.get('X-Order-Token'))); },
    async status(req,res) { reply(req,res,await orders.changeStatus(req.context.store,req.auth,req.validated.params.orderId,req.validated.body,req.context.locale)); },
    async settings(req,res) { reply(req,res,await orders.getSettings(req.context.store,req.auth)); },
    async updateSettings(req,res) { reply(req,res,await orders.setSettings(req.context.store,req.auth,req.validated.body)); },
  };
}
