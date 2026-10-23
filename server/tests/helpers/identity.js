import { randomBytes } from 'node:crypto';
import { createUsersService } from '../../src/modules/users/users.service.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { testConfig } from './config.js';

const id = () => randomBytes(12).toString('hex');
const copy = value => value ? structuredClone(value) : null;
const duplicate = () => Object.assign(new Error('duplicate key'), { code: 11000 });

export function identityFixture() {
  const accounts = new Map();
  const challenges = new Map();
  const sessions = new Map();
  const assignments = new Map();
  const emails = [];
  const audits = [];
  let auditFailure = false;
  let clock = new Date();
  let emailFailure = false;
  const now = () => new Date(clock);
  const account = (store, userId) => {
    const user = accounts.get(String(userId));
    return user?.store === store ? user : null;
  };
  const usersRepository = {
    async findByEmail(store, email) {
      return copy([...accounts.values()].find(user => user.store === store && user.email === email));
    },
    async findById(store, userId) { return copy(account(store, userId)); },
    async create(data) {
      if ([...accounts.values()].some(user => user.store === data.store && user.email === data.email)) throw duplicate();
      const user = { _id: id(), authVersion: 0, emailVerifiedAt: null, addresses: [], createdAt: now(), ...data };
      accounts.set(user._id, user);
      return copy(user);
    },
    async confirmEmail(store, userId, timestamp) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || user.emailVerifiedAt) return null;
      user.emailVerifiedAt = timestamp;
      return copy(user);
    },
    async changePassword(store, userId, version, passwordHash) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || user.authVersion !== version) return null;
      user.passwordHash = passwordHash;
      user.authVersion++;
      return copy(user);
    },
    async updateProfile(store, userId, fields) {
      const user = account(store, userId);
      if (!user || user.status !== 'active') return null;
      Object.assign(user, fields);
      return copy(user);
    },
    async addAddress(store, userId, address) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || user.role !== 'user') return null;
      user.addresses.push({ district: '', floor: '', apartment: '', details: '', contactPhone: null, ...address });
      return copy(user);
    },
    async updateAddress(store, userId, addressId, fields) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || user.role !== 'user') return null;
      const address = user.addresses.find(item => String(item._id) === String(addressId));
      if (!address) return null;
      Object.assign(address, fields);
      return copy(user);
    },
    async removeAddress(store, userId, addressId) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || user.role !== 'user') return null;
      const index = user.addresses.findIndex(item => String(item._id) === String(addressId));
      if (index < 0) return null;
      user.addresses.splice(index, 1);
      return copy(user);
    },
    async listAccounts(store, { page, limit, role, status }) {
      const users = [...accounts.values()].filter(user => user.store === store && (!role || user.role === role)
        && (status ? user.status === status : user.status !== 'deleted'));
      return [copy(users.slice((page - 1) * limit, page * limit)), users.length];
    },
    async updateAccount(store, userId, fields, version) {
      const user = account(store, userId);
      if (!user || user.role === 'superAdmin' || user.status === 'deleted' || user.authVersion !== version) return null;
      Object.assign(user, fields);
      user.authVersion++;
      return copy(user);
    },
    async softDeleteAccount(store, userId, version, timestamp) {
      return this.updateAccount(store, userId, { status: 'deleted', deletedAt: timestamp }, version);
    },
    async setSuperAdminRole(store, userId, role, expectedRole, version) {
      const user = account(store, userId);
      if (!user || user.status !== 'active' || !user.emailVerifiedAt || user.role !== expectedRole || user.authVersion !== version) return null;
      user.role = role;
      user.authVersion++;
      return copy(user);
    },
    async createAudit(data) {
      if (auditFailure) throw new Error('audit failed');
      audits.push(copy(data));
      return copy(data);
    },
  };
  const key = (store, userId, purpose) => `${store}:${userId}:${purpose}`;
  const activeSession = (store, sessionId, timestamp) => {
    const session = sessions.get(String(sessionId));
    return session?.store === store && !session.revokedAt && session.expiresAt > timestamp ? session : null;
  };
  const repository = {
    async issueChallenge(data, notAfter) {
      const k = key(data.store, data.userId, data.purpose);
      const old = challenges.get(k);
      if (old && old.lastSentAt > notAfter) throw duplicate();
      const challenge = { ...data, _id: old?._id ?? id(), attempts: 0, consumedAt: null };
      challenges.set(k, challenge);
      return copy(challenge);
    },
    async discardChallenge(store, challengeId, digest) {
      for (const [k, challenge] of challenges) {
        if (challenge.store === store && challenge._id === String(challengeId) && challenge.digest === digest) challenges.delete(k);
      }
    },
    async attemptChallenge(store, userId, purpose, timestamp, limit) {
      const challenge = challenges.get(key(store, userId, purpose));
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= timestamp || challenge.attempts >= limit) return null;
      challenge.attempts++;
      return copy(challenge);
    },
    async consumeChallenge(store, challengeId, digest, timestamp) {
      const challenge = [...challenges.values()].find(item => item.store === store && item._id === String(challengeId));
      if (!challenge || challenge.digest !== digest || challenge.consumedAt || challenge.expiresAt <= timestamp) return null;
      challenge.consumedAt = timestamp;
      return copy(challenge);
    },
    async createSession(data) {
      const session = { ...data, _id: String(data._id), userId: String(data.userId), revokedAt: null };
      sessions.set(session._id, session);
      return copy(session);
    },
    async findSession(store, sessionId, userId, timestamp) {
      const session = activeSession(store, sessionId, timestamp);
      return session?.userId === String(userId) ? copy(session) : null;
    },
    async rotateSession(store, sessionId, digest, replacement, timestamp) {
      const session = activeSession(store, sessionId, timestamp);
      if (!session || session.refreshDigest !== digest) return null;
      session.refreshDigest = replacement;
      return copy(session);
    },
    async revokeSession(store, sessionId, userId, timestamp) {
      const session = sessions.get(String(sessionId));
      if (session?.store === store && session.userId === String(userId)) session.revokedAt = timestamp;
    },
    async isSuperAdmin(store, userId) { return assignments.get(store) === String(userId); },
    async findAssignment(store) { return assignments.has(store) ? { store, userId: assignments.get(store) } : null; },
    async createAssignment(store, userId) {
      if (assignments.has(store)) throw duplicate();
      assignments.set(store, String(userId));
      return { store, userId: String(userId) };
    },
    async replaceAssignment(store, currentId, nextId) {
      if (assignments.get(store) !== String(currentId)) return null;
      assignments.set(store, String(nextId));
      return { store, userId: String(nextId) };
    },
  };
  const email = {
    assertReady() {},
    async sendOtp(message) {
      if (emailFailure) throw new Error('smtp-private-credentials');
      emails.push(message);
    },
  };
  const users = createUsersService(usersRepository);
  let pending = Promise.resolve();
  function transaction(work) {
    const operation = pending.then(async () => {
      const snapshots = [accounts, challenges, sessions, assignments].map(map => copy([...map]));
      const auditSnapshot = copy(audits);
      try { return await work({ testSession: true }); }
      catch (error) {
        [accounts, challenges, sessions, assignments].forEach((map, index) => {
          map.clear();
          for (const [key, value] of snapshots[index]) map.set(key, value);
        });
        audits.splice(0, audits.length, ...auditSnapshot);
        throw error;
      }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  const auth = createAuthService(testConfig, { users, email, repository, now, transaction });
  return { users, auth, repository, userRepository: usersRepository, transaction,
    email, accounts, challenges, sessions, assignments, emails, audits,
    failAudit(value) { auditFailure = value; },
    advance(ms) { clock = new Date(clock.getTime() + ms); },
    failEmail(value) { emailFailure = value; },
    async signup(store = 'b2c') {
      const input = { name: 'Customer', email: 'customer@example.com', phone: '+201001234567', password: 'password123' };
      await auth.register(store, input, 'en');
      return { input, otp: emails.at(-1).code, user: [...accounts.values()].find(user => user.store === store) };
    },
    async verified(store = 'b2c') {
      const result = await this.signup(store);
      await auth.verifyEmail(store, result.input.email, result.otp);
      return result;
    },
  };
}
