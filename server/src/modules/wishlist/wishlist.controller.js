import { sendSuccess } from '../../shared/utils/response.js';

export function createWishlistController(wishlist) {
  return {
    async get(req, res) { sendSuccess(res, { data: await wishlist.get(req.context.store, req.auth, req.context.locale) }); },
    async add(req, res) { sendSuccess(res, { data: await wishlist.add(req.context.store, req.auth, req.validated.params.productId, req.context.locale) }); },
    async remove(req, res) { sendSuccess(res, { data: await wishlist.remove(req.context.store, req.auth, req.validated.params.productId, req.context.locale) }); },
    async clear(req, res) { sendSuccess(res, { data: await wishlist.clear(req.context.store, req.auth, req.context.locale) }); },
  };
}
