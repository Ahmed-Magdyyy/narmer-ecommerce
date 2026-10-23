import { sendSuccess } from '../../shared/utils/response.js';

export function createUsersController(users, staff) {
  return {
    async me(req, res) {
      sendSuccess(res, { data: await users.getProfile(req.context.store, req.auth.userId) });
    },
    async updateMe(req, res) {
      sendSuccess(res, { data: await users.updateProfile(req.context.store, req.auth.userId, req.validated.body) });
    },
    async addresses(req, res) {
      sendSuccess(res, { data: await users.listAddresses(req.context.store, req.auth.userId) });
    },
    async address(req, res) {
      sendSuccess(res, { data: await users.getAddress(req.context.store, req.auth.userId, req.validated.params.addressId) });
    },
    async addAddress(req, res) {
      sendSuccess(res, { status: 201, data: await users.addAddress(req.context.store, req.auth.userId, req.validated.body) });
    },
    async updateAddress(req, res) {
      sendSuccess(res, { data: await users.updateAddress(req.context.store, req.auth.userId,
        req.validated.params.addressId, req.validated.body) });
    },
    async removeAddress(req, res) {
      await users.removeAddress(req.context.store, req.auth.userId, req.validated.params.addressId);
      sendSuccess(res);
    },
    async listAccounts(req, res) {
      sendSuccess(res, { data: await staff.list(req.context.store, req.auth, req.validated.query) });
    },
    async getAccount(req, res) {
      sendSuccess(res, { data: await staff.get(req.context.store, req.auth, req.validated.params.userId) });
    },
    async updateAccount(req, res) {
      sendSuccess(res, { data: await staff.update(req.context.store, req.auth, req.validated.params.userId, req.validated.body) });
    },
    async removeAccount(req, res) {
      await staff.remove(req.context.store, req.auth, req.validated.params.userId);
      sendSuccess(res);
    },
  };
}
