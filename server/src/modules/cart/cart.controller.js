import { sendSuccess } from '../../shared/utils/response.js';

export function createCartController(cart) {
  return {
    async get(req, res) { sendSuccess(res, { data: await cart.get(req.context.store, req.cartOwner, req.context.locale) }); },
    async setItem(req, res) { sendSuccess(res, { data: await cart.setItem(req.context.store, req.cartOwner, req.validated.body, req.context.locale) }); },
    async clear(req, res) { sendSuccess(res, { data: await cart.clear(req.context.store, req.cartOwner, req.context.locale) }); },
    async merge(req, res) {
      const data = req.guestCartToken ? await cart.merge(req.context.store, req.cartOwner, req.guestCartToken, req.context.locale)
        : await cart.get(req.context.store, req.cartOwner, req.context.locale);
      res.clearCookie('narmer_cart_b2c', req.cartCookieOptions);
      sendSuccess(res, { data });
    },
  };
}
