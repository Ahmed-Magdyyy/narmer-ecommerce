import { User, UserAudit } from './users.model.js';

export const usersRepository = {
  initialize: () => Promise.all([User.init(), UserAudit.init()]),
  findByEmail: (store, email, session = null) => User.findOne({ store, email }).session(session).select('+passwordHash +authVersion').lean(),
  findById: (store, id, session = null) => User.findOne({ store, _id: id }).session(session).select('+authVersion').lean(),
  create: async data => (await User.create(data)).toObject(),
  confirmEmail: (store, id, now) => User.findOneAndUpdate(
    { store, _id: id, status: 'active', emailVerifiedAt: null },
    { $set: { emailVerifiedAt: now } }, { returnDocument: 'after', runValidators: true },
  ).select('+authVersion').lean(),
  changePassword: (store, id, version, passwordHash) => User.findOneAndUpdate(
    { store, _id: id, status: 'active', authVersion: version },
    { $set: { passwordHash }, $inc: { authVersion: 1 } }, { returnDocument: 'after', runValidators: true },
  ).select('+authVersion').lean(),
  updateProfile: (store, id, fields) => User.findOneAndUpdate(
    { store, _id: id, status: 'active' }, { $set: fields }, { returnDocument: 'after', runValidators: true },
  ).lean(),
  addAddress: (store, id, address) => User.findOneAndUpdate(
    { store, _id: id, status: 'active', role: 'user' }, { $push: { addresses: address } },
    { returnDocument: 'after', runValidators: true },
  ).lean(),
  updateAddress: (store, id, addressId, fields) => User.findOneAndUpdate(
    { store, _id: id, status: 'active', role: 'user', 'addresses._id': addressId },
    { $set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`addresses.$.${key}`, value])) },
    { returnDocument: 'after', runValidators: true },
  ).lean(),
  removeAddress: (store, id, addressId) => User.findOneAndUpdate(
    { store, _id: id, status: 'active', role: 'user', 'addresses._id': addressId },
    { $pull: { addresses: { _id: addressId } } }, { returnDocument: 'after' },
  ).lean(),
  listAccounts: (store, { page, limit, role, status }) => {
    const filter = { store, ...(role ? { role } : {}), status: status ?? { $ne: 'deleted' } };
    return Promise.all([
      User.find(filter).select('-addresses').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
  },
  updateAccount: (store, id, fields, version, session) => User.findOneAndUpdate(
    { store, _id: id, authVersion: version, role: { $ne: 'superAdmin' }, status: { $ne: 'deleted' } },
    { $set: fields, $inc: { authVersion: 1 } }, { returnDocument: 'after', runValidators: true, session },
  ).select('+authVersion').lean(),
  softDeleteAccount: (store, id, version, now, session) => User.findOneAndUpdate(
    { store, _id: id, authVersion: version, role: { $ne: 'superAdmin' }, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted', deletedAt: now }, $inc: { authVersion: 1 } },
    { returnDocument: 'after', runValidators: true, session },
  ).select('+authVersion').lean(),
  setSuperAdminRole: (store, id, role, expectedRole, version, session) => User.findOneAndUpdate(
    { store, _id: id, role: expectedRole, authVersion: version, status: 'active', emailVerifiedAt: { $ne: null } },
    { $set: { role }, $inc: { authVersion: 1 } }, { returnDocument: 'after', runValidators: true, session },
  ).select('+authVersion').lean(),
  createAudit: async (data, session) => (await UserAudit.create([data], { session }))[0].toObject(),
};
