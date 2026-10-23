import { AppError } from '../../shared/errors/app-error.js';
import { usersRepository } from './users.repository.js';
import { randomBytes } from 'node:crypto';
import { normalizePhone } from '../../shared/utils/phone.js';

const addressFields = ['label', 'governorate', 'district', 'building', 'street', 'floor', 'apartment', 'details', 'contactPhone'];
function addressInput(input) {
  return Object.fromEntries(addressFields.filter(key => Object.hasOwn(input, key)).map(key => [key,
    key === 'contactPhone' ? (input[key]?.trim() ? normalizePhone(input[key].trim()) : null) : input[key]]));
}
function presentAddress(user, address) {
  const { _id, ...fields } = address;
  return { id: String(_id), ...fields, effectiveContactPhone: address.contactPhone ?? user.phone };
}

export function publicUser(user) {
  return {
    id: String(user._id), store: user.store, name: user.name, email: user.email,
    phone: user.phone, role: user.role, emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export function createUsersService(repository = usersRepository) {
  function checkStore(store) {
    if (!['b2c', 'b2b'].includes(store)) throw new AppError(400, 'INVALID_STORE');
  }
  async function customerAccount(store, id) {
    checkStore(store);
    const user = await repository.findById(store, id);
    if (!user || user.status !== 'active') throw new AppError(401, 'UNAUTHORIZED');
    if (user.role !== 'user') throw new AppError(403, 'FORBIDDEN');
    return user;
  }
  return {
    async findAccountByEmail(store, email, session) {
      checkStore(store);
      return repository.findByEmail(store, email.trim().toLowerCase(), session);
    },
    async findAccountById(store, id, session) {
      checkStore(store);
      return repository.findById(store, id, session);
    },
    async registerAccount(store, { name, email, phone }, passwordHash) {
      checkStore(store);
      return repository.create({ store, name, email: email.trim().toLowerCase(), phone,
        passwordHash, role: 'user', status: 'active' });
    },
    async confirmEmail(store, id, now) {
      checkStore(store);
      return repository.confirmEmail(store, id, now);
    },
    async changePassword(store, id, version, passwordHash) {
      checkStore(store);
      return repository.changePassword(store, id, version, passwordHash);
    },
    async getProfile(store, id) {
      checkStore(store);
      const user = await repository.findById(store, id);
      if (!user || user.status !== 'active') throw new AppError(401, 'UNAUTHORIZED');
      return publicUser(user);
    },
    async updateProfile(store, id, input) {
      checkStore(store);
      const fields = {};
      for (const key of ['name', 'phone']) if (Object.hasOwn(input, key)) fields[key] = input[key];
      if (!Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR');
      const user = await repository.updateProfile(store, id, fields);
      if (!user) throw new AppError(401, 'UNAUTHORIZED');
      return publicUser(user);
    },
    async listAddresses(store, id) {
      const user = await customerAccount(store, id);
      return (user.addresses ?? []).map(address => presentAddress(user, address));
    },
    async getAddress(store, id, addressId) {
      const user = await customerAccount(store, id);
      const address = (user.addresses ?? []).find(item => String(item._id) === String(addressId));
      if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND');
      return presentAddress(user, address);
    },
    async addAddress(store, id, input) {
      checkStore(store);
      const addressId = randomBytes(12).toString('hex');
      const user = await repository.addAddress(store, id, { _id: addressId, ...addressInput(input) });
      if (!user) throw new AppError(403, 'FORBIDDEN');
      return presentAddress(user, user.addresses.find(address => String(address._id) === addressId));
    },
    async updateAddress(store, id, addressId, input) {
      checkStore(store);
      const fields = addressInput(input);
      if (!Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR');
      const user = await repository.updateAddress(store, id, addressId, fields);
      if (!user) throw new AppError(404, 'ADDRESS_NOT_FOUND');
      return presentAddress(user, user.addresses.find(address => String(address._id) === String(addressId)));
    },
    async removeAddress(store, id, addressId) {
      checkStore(store);
      if (!await repository.removeAddress(store, id, addressId)) throw new AppError(404, 'ADDRESS_NOT_FOUND');
    },
    async setSuperAdminRole(store, id, role, expectedRole, version, session) {
      checkStore(store);
      return repository.setSuperAdminRole(store, id, role, expectedRole, version, session);
    },
    async recordStaffChange(data, session) {
      checkStore(data.store);
      return repository.createAudit(data, session);
    },
  };
}
