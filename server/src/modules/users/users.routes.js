import { Router } from 'express';
import { createUsersController } from './users.controller.js';
import { updateProfileValidator, addAddressValidator, updateAddressValidator, addressIdValidator,
  accountIdValidator, accountListValidator, updateAccountValidator } from './users.validator.js';
import { requireRoles } from '../auth/auth.middleware.js';

export function createUsersRouter(users, authenticate) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const controller = createUsersController(users);
  router.use(authenticate);
  router.get('/me', controller.me);
  router.patch('/me', updateProfileValidator, controller.updateMe);
  router.use('/me/addresses', requireRoles('user'));
  router.get('/me/addresses', controller.addresses);
  router.get('/me/addresses/:addressId', addressIdValidator, controller.address);
  router.post('/me/addresses', addAddressValidator, controller.addAddress);
  router.patch('/me/addresses/:addressId', updateAddressValidator, controller.updateAddress);
  router.delete('/me/addresses/:addressId', addressIdValidator, controller.removeAddress);
  return router;
}

export function createStaffUsersRouter(users, staff, authenticate) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const controller = createUsersController(users, staff);
  router.use(authenticate, requireRoles('superAdmin', 'admin'));
  router.get('/', accountListValidator, controller.listAccounts);
  router.get('/:userId', accountIdValidator, controller.getAccount);
  router.patch('/:userId', updateAccountValidator, controller.updateAccount);
  router.delete('/:userId', requireRoles('superAdmin'), accountIdValidator, controller.removeAccount);
  return router;
}
