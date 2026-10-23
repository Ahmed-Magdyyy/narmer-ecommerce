import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { usersRepository } from './users.repository.js';
import { publicUser } from './users.service.js';

const staffView = user => ({ ...publicUser(user), status: user.status,
  createdAt: user.createdAt, deletedAt: user.deletedAt ?? null });

export function createStaffUsersService({ auth, repository = usersRepository, transaction = runTransaction }) {
  return {
    async list(store, identity, input) {
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const paging = { ...input, page: input.page ?? 1, limit: input.limit ?? 20 };
      const [users, total] = await repository.listAccounts(store, paging);
      return { items: users.map(staffView), pagination: { page: paging.page, limit: paging.limit, total,
        pages: Math.ceil(total / paging.limit) } };
    },
    async get(store, identity, id) {
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const user = await repository.findById(store, id);
      if (!user) throw new AppError(404, 'ACCOUNT_NOT_FOUND');
      return staffView(user);
    },
    async update(store, identity, id, input) {
      const fields = Object.fromEntries(['name', 'phone', 'role', 'status']
        .filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
      if (!Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR');
      if (fields.role && !['admin', 'moderator', 'user'].includes(fields.role)) throw new AppError(403, 'FORBIDDEN');
      if (fields.status && !['active', 'blocked'].includes(fields.status)) throw new AppError(403, 'FORBIDDEN');
      return transaction(async session => {
        const actor = await auth.authorizeStaff(store, identity, ['superAdmin', 'admin'], session);
        const user = await repository.findById(store, id, session);
        if (!user || user.status === 'deleted') throw new AppError(404, 'ACCOUNT_NOT_FOUND');
        if (user.role === 'superAdmin' || await auth.isSuperAdmin(store, id, session)) {
          throw new AppError(409, 'SUPER_ADMIN_PROTECTED');
        }
        const changed = await repository.updateAccount(store, id, fields, user.authVersion, session);
        if (!changed) throw new AppError(409, 'ACCOUNT_CONFLICT');
        await repository.createAudit({ store, actorId: actor._id, targetId: user._id,
          action: 'account.updated', fields: Object.keys(fields),
          before: { role: user.role, status: user.status }, after: { role: changed.role, status: changed.status } }, session);
        return staffView(changed);
      });
    },
    async remove(store, identity, id) {
      return transaction(async session => {
        const actor = await auth.authorizeStaff(store, identity, ['superAdmin'], session);
        const user = await repository.findById(store, id, session);
        if (!user || user.status === 'deleted') throw new AppError(404, 'ACCOUNT_NOT_FOUND');
        if (user.role === 'superAdmin' || await auth.isSuperAdmin(store, id, session)) {
          throw new AppError(409, 'SUPER_ADMIN_PROTECTED');
        }
        const changed = await repository.softDeleteAccount(store, id, user.authVersion, new Date(), session);
        if (!changed) throw new AppError(409, 'ACCOUNT_CONFLICT');
        await repository.createAudit({ store, actorId: actor._id, targetId: user._id, action: 'account.deleted',
          before: { role: user.role, status: user.status }, after: { role: changed.role, status: changed.status } }, session);
      });
    },
  };
}
