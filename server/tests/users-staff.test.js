import test from 'node:test';
import assert from 'node:assert/strict';
import { identityFixture } from './helpers/identity.js';
import { createStaffUsersService } from '../src/modules/users/users.staff.service.js';

async function account(f, email, store = 'b2c', confirmed = true) {
  const input = { name: 'Customer', email, phone: '+201001234567', password: 'password123' };
  await f.auth.register(store, input, 'en');
  if (confirmed) await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
  const user = await f.users.findAccountByEmail(store, email);
  return { ...input, id: user._id };
}
async function staffFixture() {
  const f = identityFixture();
  const owner = await account(f, 'owner@example.com');
  await f.auth.provisionSuperAdmin('b2c', owner.email);
  const login = await f.auth.login('b2c', owner.email, owner.password);
  const identity = await f.auth.authenticate('b2c', login.accessToken);
  const staff = createStaffUsersService({ auth: f.auth, repository: f.userRepository, transaction: f.transaction });
  return { ...f, staff, owner, identity, login };
}
const address = { label: 'بيت', governorate: 'Cairo', building: '12A', street: 'Main street', floor: 'Ground' };

test('only the assigned superAdmin creates active role-selected accounts without email or privileged input overrides', async () => {
  const f = await staffFixture();
  const emailCount = f.emails.length;
  f.failEmail(true);
  for (const role of ['admin', 'moderator', 'user']) {
    const input = { name: 'New Account', email: `${role}@example.com`, phone: '+201001234567', password: 'InitialPass123!', role,
      store: 'b2b', status: 'blocked', emailVerifiedAt: null, authVersion: 99 };
    const created = await f.staff.create('b2c', f.identity, input);
    assert.equal(created.store, 'b2c');
    assert.equal(created.role, role);
    assert.equal(created.status, 'active');
    assert.equal(created.emailVerified, true);
    assert.equal(Object.hasOwn(created, 'passwordHash'), false);
    const stored = f.accounts.get(created.id);
    assert.equal(stored.authVersion, 0);
    assert.notEqual(stored.passwordHash, input.password);
    const login = await f.auth.login('b2c', input.email, input.password);
    const identity = await f.auth.authenticate('b2c', login.accessToken);
    await assert.rejects(f.staff.create('b2c', identity, { ...input, email: 'denied@example.com' }), { code: 'FORBIDDEN' });
    await assert.rejects(f.staff.create('b2b', identity, input), { code: 'UNAUTHORIZED' });
  }
  assert.equal(f.emails.length, emailCount);
  assert.equal(f.audits.filter(audit => audit.action === 'account.created').length, 3);
  assert.ok(!JSON.stringify(f.audits).includes('InitialPass123!'));
  assert.ok(!JSON.stringify(f.audits).includes('passwordHash'));
  await assert.rejects(f.staff.create('b2c', f.identity, { role: 'superAdmin' }), { code: 'FORBIDDEN' });
});

test('account creation reserves normalized email, has one concurrent winner, and rolls back on audit failure', async () => {
  const f = await staffFixture();
  const input = { name: 'New Account', email: ' NEW@EXAMPLE.COM ', phone: '+201001234567', password: 'InitialPass123!', role: 'user' };
  f.failAudit(true);
  await assert.rejects(f.staff.create('b2c', f.identity, input), /audit failed/);
  assert.equal(await f.users.findAccountByEmail('b2c', input.email), null);
  f.failAudit(false);
  const results = await Promise.allSettled([f.staff.create('b2c', f.identity, input), f.staff.create('b2c', f.identity, input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ACCOUNT_EMAIL_EXISTS');
  const created = results.find(result => result.status === 'fulfilled').value;
  assert.equal(created.email, 'new@example.com');
  f.accounts.get(created.id).status = 'blocked';
  await assert.rejects(f.staff.create('b2c', f.identity, input), { code: 'ACCOUNT_EMAIL_EXISTS' });
  f.accounts.get(created.id).status = 'deleted';
  await assert.rejects(f.staff.create('b2c', f.identity, input), { code: 'ACCOUNT_EMAIL_EXISTS' });
  assert.equal(f.audits.filter(audit => audit.action === 'account.created').length, 1);
});

test('a signed-in customer can change a manually supplied password; current password, session and version are enforced', async () => {
  const f = await staffFixture();
  const input = { name: 'New Customer', email: 'new@example.com', phone: '+201001234567', password: 'InitialPass123!', role: 'user' };
  await f.staff.create('b2c', f.identity, input);
  const first = await f.auth.login('b2c', input.email, input.password);
  const second = await f.auth.login('b2c', input.email, input.password);
  const identity = await f.auth.authenticate('b2c', first.accessToken);
  await assert.rejects(f.auth.changePassword('b2c', identity, 'WrongPass123!', 'ChangedPass123!'), { code: 'INVALID_CURRENT_PASSWORD' });
  await f.auth.authenticate('b2c', first.accessToken);
  const results = await Promise.allSettled([
    f.auth.changePassword('b2c', identity, input.password, 'ChangedPass123!'),
    f.auth.changePassword('b2c', identity, input.password, 'OtherPass123!'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ACCOUNT_CONFLICT');
  for (const login of [first, second]) {
    await assert.rejects(f.auth.authenticate('b2c', login.accessToken), { code: 'UNAUTHORIZED' });
    await assert.rejects(f.auth.refresh('b2c', login.refreshToken), { code: 'UNAUTHORIZED' });
  }
  await assert.rejects(f.auth.changePassword('b2c', identity, input.password, 'LaterPass123!'), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.auth.login('b2c', input.email, input.password), { code: 'INVALID_CREDENTIALS' });
  const winner = results[0].status === 'fulfilled' ? 'ChangedPass123!' : 'OtherPass123!';
  assert.equal((await f.auth.login('b2c', input.email, winner)).user.role, 'user');
});

test('addresses belong to their customer/store, preserve concurrent edits, and use the current main phone', async () => {
  const f = identityFixture();
  const a = await account(f, 'a@example.com');
  const b = await account(f, 'b@example.com');
  const otherStore = await account(f, 'a@example.com', 'b2b');
  const added = await Promise.all([f.users.addAddress('b2c', a.id, address), f.users.addAddress('b2c', a.id, address)]);
  assert.equal((await f.users.listAddresses('b2c', a.id)).length, 2);
  assert.equal(added[0].effectiveContactPhone, a.phone);
  await f.users.updateProfile('b2c', a.id, { phone: '+201009876543' });
  assert.equal((await f.users.getAddress('b2c', a.id, added[0].id)).effectiveContactPhone, '+201009876543');
  await Promise.all([
    f.users.updateAddress('b2c', a.id, added[0].id, { contactPhone: '+20 (100) 123-4567' }),
    f.users.updateAddress('b2c', a.id, added[0].id, { apartment: '12B' }),
  ]);
  const updated = await f.users.getAddress('b2c', a.id, added[0].id);
  assert.equal(updated.apartment, '12B');
  assert.equal(updated.contactPhone, '+201001234567');
  for (const clear of [null, '']) {
    assert.equal((await f.users.updateAddress('b2c', a.id, added[0].id, { contactPhone: clear })).effectiveContactPhone, '+201009876543');
  }
  await assert.rejects(f.users.getAddress('b2c', b.id, added[0].id), { code: 'ADDRESS_NOT_FOUND' });
  await assert.rejects(f.users.removeAddress('b2b', otherStore.id, added[0].id), { code: 'ADDRESS_NOT_FOUND' });
  await f.users.removeAddress('b2c', a.id, added[0].id);
  assert.equal((await f.users.listAddresses('b2c', a.id)).length, 1);
  f.accounts.get(a.id).role = 'admin';
  await assert.rejects(f.users.addAddress('b2c', a.id, address), { code: 'FORBIDDEN' });
  await assert.rejects(f.users.listAddresses('b2c', a.id), { code: 'FORBIDDEN' });
});

test('provisioning requires confirmation, is independent per store, and rolls back if audit fails', async () => {
  const f = identityFixture();
  const pending = await account(f, 'pending@example.com', 'b2c', false);
  await assert.rejects(f.auth.provisionSuperAdmin('b2c', pending.email), { code: 'INVALID_SUPER_ADMIN_TARGET' });
  const owner = await account(f, 'owner@example.com');
  f.failAudit(true);
  await assert.rejects(f.auth.provisionSuperAdmin('b2c', owner.email), /audit failed/);
  assert.equal(f.assignments.size, 0);
  assert.equal(f.accounts.get(owner.id).role, 'user');
  assert.equal(f.accounts.get(owner.id).authVersion, 0);
  f.failAudit(false);
  await f.auth.provisionSuperAdmin('b2c', owner.email.toUpperCase());
  await assert.rejects(f.auth.provisionSuperAdmin('b2c', owner.email), { code: 'SUPER_ADMIN_ALREADY_SET' });
  const second = await account(f, owner.email, 'b2b');
  await f.auth.provisionSuperAdmin('b2b', second.email);
  assert.equal(f.assignments.size, 2);
  assert.notEqual(f.assignments.get('b2b'), f.assignments.get('b2c'));
  assert.equal(f.audits.length, 2);
});

test('staff permissions protect the holder, scope accounts, and invalidate sessions on role/status changes', async () => {
  const f = await staffFixture();
  const admin = await account(f, 'admin@example.com');
  const target = await account(f, 'target@example.com');
  const outside = await account(f, 'outside@example.com', 'b2b');
  await f.staff.update('b2c', f.identity, admin.id, { role: 'admin' });
  const adminLogin = await f.auth.login('b2c', admin.email, admin.password);
  const adminIdentity = await f.auth.authenticate('b2c', adminLogin.accessToken);
  assert.equal((await f.staff.list('b2c', adminIdentity, {})).pagination.total, 3);
  await assert.rejects(f.staff.remove('b2c', adminIdentity, target.id), { code: 'FORBIDDEN' });
  await assert.rejects(f.staff.remove('b2c', f.identity, f.owner.id), { code: 'SUPER_ADMIN_PROTECTED' });
  await assert.rejects(f.staff.update('b2c', adminIdentity, f.owner.id, { status: 'blocked' }), { code: 'SUPER_ADMIN_PROTECTED' });
  await assert.rejects(f.staff.update('b2c', adminIdentity, target.id, { role: 'superAdmin' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.staff.update('b2c', adminIdentity, target.id, { status: 'deleted' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.staff.update('b2c', adminIdentity, outside.id, { name: 'Wrong store' }), { code: 'ACCOUNT_NOT_FOUND' });
  const targetLogin = await f.auth.login('b2c', target.email, target.password);
  await f.staff.update('b2c', adminIdentity, target.id, { role: 'moderator', status: 'blocked' });
  await assert.rejects(f.auth.authenticate('b2c', targetLogin.accessToken), { code: 'UNAUTHORIZED' });
  await f.staff.update('b2c', adminIdentity, target.id, { status: 'active' });
  await assert.rejects(f.auth.refresh('b2c', targetLogin.refreshToken), { code: 'UNAUTHORIZED' });
  const moderator = await f.auth.login('b2c', target.email, target.password);
  await assert.rejects(f.staff.list('b2c', await f.auth.authenticate('b2c', moderator.accessToken), {}), { code: 'FORBIDDEN' });
});

test('soft deletion retains account/email and revokes credentials; failed audit rolls back mutations', async () => {
  const f = await staffFixture();
  const target = await account(f, 'target@example.com');
  const login = await f.auth.login('b2c', target.email, target.password);
  f.failAudit(true);
  await assert.rejects(f.staff.remove('b2c', f.identity, target.id), /audit failed/);
  assert.equal(f.accounts.get(target.id).status, 'active');
  await f.auth.authenticate('b2c', login.accessToken);
  f.failAudit(false);
  await f.staff.remove('b2c', f.identity, target.id);
  const deleted = f.accounts.get(target.id);
  assert.equal(deleted.status, 'deleted');
  assert.ok(deleted.deletedAt);
  assert.equal((await f.staff.list('b2c', f.identity, {})).pagination.total, 1);
  await assert.rejects(f.auth.authenticate('b2c', login.accessToken), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.auth.refresh('b2c', login.refreshToken), { code: 'UNAUTHORIZED' });
  await f.auth.register('b2c', { ...target, password: 'different123' }, 'en');
  assert.equal(f.accounts.size, 2);
  assert.equal(f.accounts.get(target.id).passwordHash, deleted.passwordHash);
  await assert.rejects(f.staff.update('b2c', f.identity, target.id, { status: 'active' }), { code: 'ACCOUNT_NOT_FOUND' });
});

test('handover is atomic, has one winner, and invalidates both accounts previous sessions', async () => {
  const f = await staffFixture();
  const next = await account(f, 'next@example.com');
  const alternate = await account(f, 'alternate@example.com');
  const nextLogin = await f.auth.login('b2c', next.email, next.password);
  const pending = await account(f, 'pending@example.com', 'b2c', false);
  const outside = await account(f, 'outside@example.com', 'b2b');
  for (const id of [f.owner.id, pending.id, outside.id]) {
    await assert.rejects(f.auth.handoverSuperAdmin('b2c', f.identity, id), { code: 'INVALID_SUPER_ADMIN_TARGET' });
  }
  f.failAudit(true);
  await assert.rejects(f.auth.handoverSuperAdmin('b2c', f.identity, next.id), /audit failed/);
  assert.equal(f.assignments.get('b2c'), f.owner.id);
  assert.equal(f.accounts.get(f.owner.id).role, 'superAdmin');
  assert.equal(f.accounts.get(next.id).role, 'user');
  await f.auth.authenticate('b2c', f.login.accessToken);
  f.failAudit(false);
  const results = await Promise.allSettled([
    f.auth.handoverSuperAdmin('b2c', f.identity, next.id),
    f.auth.handoverSuperAdmin('b2c', f.identity, alternate.id),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.accounts.get(f.owner.id).role, 'admin');
  assert.equal([...f.accounts.values()].filter(user => user.role === 'superAdmin').length, 1);
  assert.equal(f.accounts.get(next.id).role, 'superAdmin');
  await assert.rejects(f.auth.authenticate('b2c', f.login.accessToken), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.auth.authenticate('b2c', nextLogin.accessToken), { code: 'UNAUTHORIZED' });
  assert.equal(f.audits.at(-1).action, 'superAdmin.handover');
});
