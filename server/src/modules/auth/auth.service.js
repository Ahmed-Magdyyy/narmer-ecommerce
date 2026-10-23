import mongoose from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import { publicUser } from '../users/users.service.js';
import { authRepository } from './auth.repository.js';
import { authPolicy, makeOtp, makeNonce, makeRefresh, refreshDigest, otpDigest, equalDigest,
  hashPassword, comparePassword, createTokens } from './auth.crypto.js';
import { runTransaction } from '../../shared/utils/transaction.js';

export function createAuthService(config, { users, email, repository = authRepository, now = () => new Date(), transaction = runTransaction }) {
  const tokens = createTokens(config);
  const unauthorized = () => new AppError(401, 'UNAUTHORIZED');

  async function ensureActive(user, session = null) {
    if (!user || user.status !== 'active') throw unauthorized();
    if (!user.emailVerifiedAt) throw new AppError(403, 'EMAIL_NOT_VERIFIED');
    if (user.role === 'superAdmin' && !await repository.isSuperAdmin(user.store, user._id, session)) throw unauthorized();
  }

  async function authorizeStaff(store, identity, roles, session = null) {
    const user = await users.findAccountById(store, identity.userId, session);
    await ensureActive(user, session);
    if (!roles.includes(user.role)) throw new AppError(403, 'FORBIDDEN');
    if (identity.sessionId) {
      const active = await repository.findSession(store, identity.sessionId, user._id, now(), session);
      if (!active || active.authVersion !== user.authVersion) throw unauthorized();
    }
    return user;
  }

  async function sendChallenge(user, purpose, locale) {
    const timestamp = now();
    const code = makeOtp();
    const data = { store: user.store, userId: user._id, purpose, authVersion: user.authVersion,
      nonce: makeNonce(), expiresAt: new Date(timestamp.getTime() + authPolicy.otpMs), lastSentAt: timestamp };
    data.digest = otpDigest(config.otpSecret, data, code);
    let challenge;
    try {
      challenge = await repository.issueChallenge(data, new Date(timestamp.getTime() - authPolicy.resendMs));
    } catch (error) {
      if (error.code === 11000) return;
      throw error;
    }
    try {
      await email.sendOtp({ to: user.email, store: user.store, purpose, code, locale });
    } catch {
      await repository.discardChallenge(user.store, challenge._id, data.digest);
      throw new AppError(503, 'EMAIL_UNAVAILABLE');
    }
  }

  async function consumeCode(user, purpose, code) {
    if (!user || user.status !== 'active') throw new AppError(400, 'INVALID_OTP');
    const challenge = await repository.attemptChallenge(user.store, user._id, purpose, now(), authPolicy.otpAttempts);
    if (!challenge || challenge.authVersion !== user.authVersion
      || !equalDigest(challenge.digest, otpDigest(config.otpSecret, challenge, code))) {
      throw new AppError(400, 'INVALID_OTP');
    }
    const consumed = await repository.consumeChallenge(user.store, challenge._id, challenge.digest, now());
    if (!consumed) throw new AppError(400, 'INVALID_OTP');
    return consumed;
  }

  function sessionResult(user, session, refreshToken) {
    return { user: publicUser(user), accessToken: tokens.sign(user, session),
      expiresIn: authPolicy.accessSeconds, refreshToken, refreshExpiresAt: session.expiresAt };
  }

  async function createSession(user) {
    const id = new mongoose.Types.ObjectId();
    const refreshToken = makeRefresh(id);
    const session = await repository.createSession({ _id: id, store: user.store, userId: user._id,
      authVersion: user.authVersion, refreshDigest: refreshDigest(refreshToken),
      expiresAt: new Date(now().getTime() + authPolicy.sessionMs) });
    return sessionResult(user, session, refreshToken);
  }

  return {
    authorizeStaff,
    isSuperAdmin: (store, id, session) => repository.isSuperAdmin(store, id, session),
    async provisionSuperAdmin(store, emailAddress) {
      try {
        return await transaction(async session => {
          if (await repository.findAssignment(store, session)) throw new AppError(409, 'SUPER_ADMIN_ALREADY_SET');
          const lookup = await users.findAccountByEmail(store, emailAddress, session);
          const user = lookup && await users.findAccountById(store, lookup._id, session);
          if (!user || user.status !== 'active' || !user.emailVerifiedAt || user.role === 'superAdmin') {
            throw new AppError(409, 'INVALID_SUPER_ADMIN_TARGET');
          }
          await repository.createAssignment(store, user._id, session);
          const changed = await users.setSuperAdminRole(store, user._id, 'superAdmin', user.role, user.authVersion, session);
          if (!changed) throw new AppError(409, 'ACCOUNT_CONFLICT');
          await users.recordStaffChange({ store, targetId: user._id, action: 'superAdmin.provisioned',
            before: { role: user.role }, after: { role: 'superAdmin', holderId: user._id } }, session);
          return publicUser(changed);
        });
      } catch (error) {
        if (error.code === 11000) throw new AppError(409, 'SUPER_ADMIN_ALREADY_SET');
        throw error;
      }
    },
    async handoverSuperAdmin(store, identity, nextId) {
      return transaction(async session => {
        const current = await authorizeStaff(store, identity, ['superAdmin'], session);
        const next = await users.findAccountById(store, nextId, session);
        if (!next || String(current._id) === String(next._id) || next.status !== 'active'
          || !next.emailVerifiedAt || next.role === 'superAdmin') throw new AppError(409, 'INVALID_SUPER_ADMIN_TARGET');
        if (!await repository.replaceAssignment(store, current._id, next._id, session)) throw new AppError(409, 'ACCOUNT_CONFLICT');
        if (!await users.setSuperAdminRole(store, current._id, 'admin', 'superAdmin', current.authVersion, session)
          || !await users.setSuperAdminRole(store, next._id, 'superAdmin', next.role, next.authVersion, session)) {
          throw new AppError(409, 'ACCOUNT_CONFLICT');
        }
        await users.recordStaffChange({ store, actorId: current._id, targetId: next._id, action: 'superAdmin.handover',
          before: { role: next.role, holderId: current._id }, after: { role: 'superAdmin', holderId: next._id } }, session);
        return { superAdminId: String(next._id), formerSuperAdminRole: 'admin' };
      });
    },
    async register(store, input, locale) {
      email.assertReady();
      let user = await users.findAccountByEmail(store, input.email);
      if (!user) {
        try { user = await users.registerAccount(store, input, await hashPassword(input.password)); }
        catch (error) {
          if (error.code !== 11000) throw error;
          user = await users.findAccountByEmail(store, input.email);
        }
      }
      // A repeated signup never changes an existing account's password or profile.
      if (user && user.status === 'active' && !user.emailVerifiedAt) await sendChallenge(user, 'verify-email', locale);
    },
    async resend(store, emailAddress, locale) {
      email.assertReady();
      const user = await users.findAccountByEmail(store, emailAddress);
      if (user && user.status === 'active' && !user.emailVerifiedAt) await sendChallenge(user, 'verify-email', locale);
    },
    async verifyEmail(store, emailAddress, code) {
      const user = await users.findAccountByEmail(store, emailAddress);
      await consumeCode(user, 'verify-email', code);
      if (!await users.confirmEmail(store, user._id, now())) throw new AppError(400, 'INVALID_OTP');
    },
    async login(store, emailAddress, password) {
      const user = await users.findAccountByEmail(store, emailAddress);
      if (!user || !await comparePassword(password, user.passwordHash)) throw new AppError(401, 'INVALID_CREDENTIALS');
      await ensureActive(user);
      return createSession(user);
    },
    async refresh(store, refreshToken) {
      if (!/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(refreshToken ?? '')) throw unauthorized();
      const id = refreshToken.split('.')[0];
      const nextToken = makeRefresh(id);
      const session = await repository.rotateSession(store, id, refreshDigest(refreshToken), refreshDigest(nextToken), now());
      if (!session) throw unauthorized();
      const user = await users.findAccountById(store, session.userId);
      await ensureActive(user);
      if (user.authVersion !== session.authVersion) throw unauthorized();
      return sessionResult(user, session, nextToken);
    },
    async authenticate(store, token) {
      const payload = tokens.verify(token, store);
      const user = await users.findAccountById(store, payload.sub);
      await ensureActive(user);
      if (user.authVersion !== payload.version) throw unauthorized();
      const session = await repository.findSession(store, payload.sid, user._id, now());
      if (!session || session.authVersion !== user.authVersion) throw unauthorized();
      return Object.freeze({ store, userId: String(user._id), role: user.role, sessionId: payload.sid });
    },
    async logout(store, identity) {
      await repository.revokeSession(store, identity.sessionId, identity.userId, now());
    },
    async forgotPassword(store, emailAddress, locale) {
      email.assertReady();
      const user = await users.findAccountByEmail(store, emailAddress);
      if (user && user.status === 'active' && user.emailVerifiedAt) await sendChallenge(user, 'reset-password', locale);
    },
    async resetPassword(store, emailAddress, code, password) {
      const user = await users.findAccountByEmail(store, emailAddress);
      if (!user?.emailVerifiedAt) throw new AppError(400, 'INVALID_OTP');
      const challenge = await consumeCode(user, 'reset-password', code);
      const changed = await users.changePassword(store, user._id, challenge.authVersion, await hashPassword(password));
      if (!changed) throw new AppError(400, 'INVALID_OTP');
      // Version changes invalidate all access tokens and refresh sessions without a multi-document transaction.
    },
  };
}
