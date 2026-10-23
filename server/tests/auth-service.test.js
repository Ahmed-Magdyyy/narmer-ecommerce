import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { identityFixture } from './helpers/identity.js';
import { testConfig } from './helpers/config.js';
import { authPolicy, hashPassword, comparePassword, makeOtp, otpDigest, equalDigest } from '../src/modules/auth/auth.crypto.js';

const failsWith = (promise, code) => assert.rejects(promise, error => error.code === code);

test('password hashing preserves spaces, rejects truncation, and never stores plaintext', async () => {
  const password = ' a long password ';
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await comparePassword(password, hash), true);
  assert.equal(await comparePassword(password.trim(), hash), false);
  assert.throws(() => hashPassword('ع'.repeat(37)), error => error.code === 'PASSWORD_TOO_LONG');
  assert.match(makeOtp(), /^\d{6}$/);
  const challenge = { store: 'b2c', userId: 'user', purpose: 'verify-email', authVersion: 0, nonce: 'nonce' };
  const digest = otpDigest(testConfig.otpSecret, challenge, '012345');
  assert.equal(equalDigest(digest, otpDigest(testConfig.otpSecret, { ...challenge, store: 'b2b' }, '012345')), false);
});

test('signup forces customer role and keeps same-email accounts independent', async () => {
  const f = identityFixture();
  const b2c = await f.signup('b2c');
  const b2b = await f.signup('b2b');
  assert.notEqual(b2c.user._id, b2b.user._id);
  await f.auth.register('b2c', { ...b2c.input, password: 'attacker123', name: 'Attacker', role: 'superAdmin', store: 'b2b' }, 'ar');
  assert.equal(b2c.user.name, 'Customer');
  assert.equal(b2c.user.role, 'user');
  assert.equal(await comparePassword('password123', b2c.user.passwordHash), true);
  assert.equal(f.emails.length, 2);
  await f.auth.verifyEmail('b2c', b2c.input.email, b2c.otp);
  assert.equal(Boolean(b2c.user.emailVerifiedAt), true);
  assert.equal(b2b.user.emailVerifiedAt, null);
});

test('confirmation is required before login and correct OTP is consumed once under concurrent requests', async () => {
  const f = identityFixture();
  const { input, otp } = await f.signup();
  await failsWith(f.auth.login('b2c', input.email, input.password), 'EMAIL_NOT_VERIFIED');
  const results = await Promise.allSettled([
    f.auth.verifyEmail('b2c', input.email, otp), f.auth.verifyEmail('b2c', input.email, otp),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await failsWith(f.auth.verifyEmail('b2c', input.email, otp), 'INVALID_OTP');
  assert.ok((await f.auth.login('b2c', input.email, input.password)).accessToken);
});

test('expired, replaced, purpose-mismatched, and exhausted OTPs are rejected', async () => {
  const f = identityFixture();
  const { input, otp } = await f.signup();
  const wrong = otp === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < authPolicy.otpAttempts; attempt++) {
    await failsWith(f.auth.verifyEmail('b2c', input.email, wrong), 'INVALID_OTP');
  }
  await failsWith(f.auth.verifyEmail('b2c', input.email, otp), 'INVALID_OTP');
  f.advance(authPolicy.resendMs + 1);
  await f.auth.resend('b2c', input.email, 'ar');
  const challenge = [...f.challenges.values()][0];
  assert.equal(challenge.attempts, 0);
  await failsWith(f.auth.resetPassword('b2c', input.email, f.emails.at(-1).code, 'new-password'), 'INVALID_OTP');
  // Force a different new code to avoid a one-in-a-million collision in the assertion.
  challenge.digest = otpDigest(testConfig.otpSecret, challenge, wrong);
  await failsWith(f.auth.verifyEmail('b2c', input.email, otp), 'INVALID_OTP');
  f.advance(authPolicy.otpMs + 1);
  await failsWith(f.auth.verifyEmail('b2c', input.email, wrong), 'INVALID_OTP');
});

test('OTP storage holds a keyed digest, and failed email delivery permits a safe retry', async () => {
  const f = identityFixture();
  f.failEmail(true);
  await failsWith(f.signup(), 'EMAIL_UNAVAILABLE');
  assert.equal(f.challenges.size, 0);
  assert.equal(f.accounts.size, 1);
  f.failEmail(false);
  await f.auth.resend('b2c', 'customer@example.com', 'ar');
  const challenge = [...f.challenges.values()][0];
  assert.match(challenge.digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(challenge, 'code'), false);
  assert.equal(f.emails.at(-1).locale, 'ar');
});

test('JWT signature, expiry, algorithm, store, and current account state are enforced', async () => {
  const f = identityFixture();
  const { user, input } = await f.verified();
  const session = await f.auth.login('b2c', input.email, input.password);
  await failsWith(f.auth.authenticate('b2b', session.accessToken), 'UNAUTHORIZED');
  await failsWith(f.auth.authenticate('b2c', `${session.accessToken.slice(0, -4)}xxxx`), 'UNAUTHORIZED');
  const original = jwt.decode(session.accessToken);
  for (const [algorithm, expiresIn] of [['HS384', 60], ['HS256', -1]]) {
    const invalid = jwt.sign({ store: 'b2c', version: 0, sid: original.sid, type: 'access' }, testConfig.jwtSecret,
      { algorithm, issuer: 'narmer-server', audience: 'narmer:b2c', subject: user._id, expiresIn });
    await failsWith(f.auth.authenticate('b2c', invalid), 'UNAUTHORIZED');
  }
  user.role = 'moderator';
  assert.equal((await f.auth.authenticate('b2c', session.accessToken)).role, 'moderator');
  user.status = 'blocked';
  await failsWith(f.auth.authenticate('b2c', session.accessToken), 'UNAUTHORIZED');
});

test('superAdmin authority comes from the current store assignment', async () => {
  const f = identityFixture();
  const { user, input } = await f.verified();
  user.role = 'superAdmin';
  await failsWith(f.auth.login('b2c', input.email, input.password), 'UNAUTHORIZED');
  f.assignments.set('b2c', user._id);
  const session = await f.auth.login('b2c', input.email, input.password);
  f.assignments.delete('b2c');
  await failsWith(f.auth.authenticate('b2c', session.accessToken), 'UNAUTHORIZED');
});

test('refresh rotation has one winner, rejects replay/cross-store access, and preserves session expiry', async () => {
  const f = identityFixture();
  const { input } = await f.verified();
  const login = await f.auth.login('b2c', input.email, input.password);
  await failsWith(f.auth.refresh('b2b', login.refreshToken), 'UNAUTHORIZED');
  const results = await Promise.allSettled([
    f.auth.refresh('b2c', login.refreshToken), f.auth.refresh('b2c', login.refreshToken),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const refreshed = results.find(result => result.status === 'fulfilled').value;
  assert.notEqual(refreshed.refreshToken, login.refreshToken);
  assert.deepEqual(refreshed.refreshExpiresAt, login.refreshExpiresAt);
  assert.notEqual([...f.sessions.values()][0].refreshDigest, refreshed.refreshToken);
  f.advance(authPolicy.sessionMs + 1);
  await failsWith(f.auth.refresh('b2c', refreshed.refreshToken), 'UNAUTHORIZED');
});

test('logout and password reset invalidate sessions while another store remains unaffected', async () => {
  const f = identityFixture();
  const { input } = await f.verified('b2c');
  await f.verified('b2b');
  const b2b = await f.auth.login('b2b', input.email, input.password);
  const first = await f.auth.login('b2c', input.email, input.password);
  await f.auth.logout('b2c', await f.auth.authenticate('b2c', first.accessToken));
  await failsWith(f.auth.authenticate('b2c', first.accessToken), 'UNAUTHORIZED');
  await failsWith(f.auth.refresh('b2c', first.refreshToken), 'UNAUTHORIZED');
  const second = await f.auth.login('b2c', input.email, input.password);
  const third = await f.auth.login('b2c', input.email, input.password);
  await f.auth.forgotPassword('b2c', input.email, 'en');
  await f.auth.resetPassword('b2c', input.email, f.emails.at(-1).code, 'new-password');
  for (const session of [second, third]) {
    await failsWith(f.auth.authenticate('b2c', session.accessToken), 'UNAUTHORIZED');
    await failsWith(f.auth.refresh('b2c', session.refreshToken), 'UNAUTHORIZED');
  }
  assert.ok(await f.auth.authenticate('b2b', b2b.accessToken));
  await failsWith(f.auth.login('b2c', input.email, input.password), 'INVALID_CREDENTIALS');
  assert.ok(await f.auth.login('b2c', input.email, 'new-password'));
});

test('unknown-account requests are generic and profile updates ignore privileged fields', async () => {
  const f = identityFixture();
  assert.equal(await f.auth.forgotPassword('b2c', 'missing@example.com', 'en'), undefined);
  assert.equal(await f.auth.resend('b2c', 'missing@example.com', 'en'), undefined);
  const { user } = await f.verified();
  const profile = await f.users.updateProfile('b2c', user._id, { name: 'New name', role: 'superAdmin', email: 'attacker@example.com' });
  assert.equal(profile.name, 'New name');
  assert.equal(profile.role, 'user');
  assert.equal(profile.email, 'customer@example.com');
  assert.equal(Object.hasOwn(profile, 'passwordHash'), false);
  assert.equal(Object.hasOwn(profile, 'authVersion'), false);
  await failsWith(f.users.getProfile('b2b', user._id), 'UNAUTHORIZED');
});
