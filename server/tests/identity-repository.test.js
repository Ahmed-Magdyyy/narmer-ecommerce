import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../src/modules/users/users.model.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { AuthChallenge, AuthSession, SuperAdminAssignment } from '../src/modules/auth/auth.model.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';

const id = 'a'.repeat(24);
const digest = 'b'.repeat(64);
const now = new Date();

test('identity schemas require store-scoped uniqueness and safe defaults', async () => {
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.email === 1 && options.unique));
  assert.ok(AuthChallenge.schema.indexes().some(([keys, options]) => keys.store === 1 && keys.userId === 1 && keys.purpose === 1 && options.unique));
  assert.ok(SuperAdminAssignment.schema.indexes().some(([keys, options]) => keys.store === 1 && options.unique));
  for (const Model of [AuthChallenge, AuthSession]) {
    assert.ok(Model.schema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
  }
  const user = new User({ store: 'b2c', name: 'Customer', email: 'CUSTOMER@EXAMPLE.COM', phone: '+201001234567', passwordHash: 'hash' });
  await user.validate();
  assert.equal(user.role, 'user');
  assert.equal(user.email, 'customer@example.com');
  assert.equal(user.authVersion, 0);
  assert.equal(User.schema.path('passwordHash').options.select, false);
});

test('repository lookup/write filters always scope by store and guard auth state', () => {
  const queries = [
    usersRepository.findByEmail('b2b', 'customer@example.com'),
    usersRepository.findById('b2b', id), usersRepository.confirmEmail('b2b', id, now),
    usersRepository.changePassword('b2b', id, 3, 'hash'), usersRepository.updateProfile('b2b', id, { name: 'New' }),
    authRepository.attemptChallenge('b2b', id, 'verify-email', now, 5),
    authRepository.consumeChallenge('b2b', id, digest, now),
    authRepository.findSession('b2b', id, id, now),
    authRepository.rotateSession('b2b', id, digest, 'replacement', now),
    authRepository.revokeSession('b2b', id, id, now),
    authRepository.discardChallenge('b2b', id, digest),
    authRepository.issueChallenge({ store: 'b2b', userId: id, purpose: 'verify-email',
      nonce: 'nonce', digest, authVersion: 0, expiresAt: now, lastSentAt: now }, now),
  ];
  for (const query of queries) assert.equal(query.getFilter().store, 'b2b');
  assert.equal(queries[3].getFilter().authVersion, 3);
  assert.equal(queries[3].getUpdate().$inc.authVersion, 1);
  assert.deepEqual(queries[5].getFilter().attempts, { $lt: 5 });
  assert.deepEqual(queries[5].getFilter().expiresAt, { $gt: now });
  assert.equal(queries[6].getFilter().digest, digest);
  assert.equal(queries[6].getFilter().consumedAt, null);
  assert.equal(queries[8].getFilter().refreshDigest, digest);
  assert.equal(queries[8].getFilter().revokedAt, null);
  assert.equal(queries[11].getOptions().upsert, true);
});

test('address writes stay atomic and scoped; staff writes guard versions and keep assignment mutable', () => {
  const addressId = 'c'.repeat(24);
  const added = usersRepository.addAddress('b2c', id, { _id: addressId, label: 'Home' });
  const updated = usersRepository.updateAddress('b2c', id, addressId, { contactPhone: null, floor: 'Ground' });
  const removed = usersRepository.removeAddress('b2c', id, addressId);
  for (const query of [added, updated, removed]) {
    assert.equal(query.getFilter().store, 'b2c');
    assert.equal(query.getFilter()._id, id);
    assert.equal(query.getFilter().role, 'user');
    assert.equal(query.getFilter().status, 'active');
  }
  assert.ok(added.getUpdate().$push.addresses);
  assert.deepEqual(updated.getUpdate().$set, { 'addresses.$.contactPhone': null, 'addresses.$.floor': 'Ground' });
  assert.equal(updated.getFilter()['addresses._id'], addressId);
  assert.deepEqual(removed.getUpdate().$pull, { addresses: { _id: addressId } });
  const session = {};
  const deleted = usersRepository.softDeleteAccount('b2b', id, 4, now, session);
  assert.equal(deleted.getFilter().store, 'b2b');
  assert.equal(deleted.getFilter().authVersion, 4);
  assert.deepEqual(deleted.getFilter().role, { $ne: 'superAdmin' });
  assert.equal(deleted.getUpdate().$set.status, 'deleted');
  assert.equal(deleted.getUpdate().$inc.authVersion, 1);
  assert.deepEqual(deleted.getOptions().session, session);
  const assignment = authRepository.replaceAssignment('b2b', id, addressId, session);
  assert.deepEqual(assignment.getFilter(), { store: 'b2b', userId: id });
  assert.equal(assignment.getUpdate().$set.userId, addressId);
  assert.equal(SuperAdminAssignment.schema.path('userId').options.immutable, undefined);
});
