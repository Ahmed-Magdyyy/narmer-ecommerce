import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import { emptyOrdersRepository } from './helpers/orders.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { emptySalesRepository } from './helpers/sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { identityFixture } from './helpers/identity.js';
import { testConfig } from './helpers/config.js';

async function fixture(t, { production = false, emailMissing = false } = {}) {
  const f = identityFixture();
  const config = { ...testConfig, nodeEnv: production ? 'production' : 'test' };
  const logs = [];
  const apiRouter = createBusinessRouter(config, { submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository, orderRepository: emptyOrdersRepository, discountRepository: emptyCouponsRepository, campaignRepository: emptySalesRepository,
    users: f.users, repository: f.repository, userRepository: f.userRepository, transaction: f.transaction,
    ...(emailMissing ? {} : { email: f.email }),
  });
  const app = createApp(config, { apiRouter, isReady: () => true,
    logger: { info: log => logs.push(log), error: log => logs.push(log) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/v1`;
  return { ...f, logs, async request(path, { method = 'POST', body, token, cookie, origin, language } = {}) {
    const response = await fetch(`${url}/${path}`, { method, headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      ...(language ? { 'X-Language': language } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, result: await response.json() };
  } };
}

test('dashboard creation is superAdmin-only in each store; customers change handed-over passwords without SMTP', async t => {
  const f = await fixture(t, { emailMissing: true, production: true });
  for (const store of ['b2c', 'b2b']) {
    const { input: owner } = await f.verified(store);
    await f.auth.provisionSuperAdmin(store, owner.email);
    const ownerLogin = await f.request(`${store}/auth/login`, { body: { email: owner.email, password: owner.password } });
    const token = ownerLogin.result.data.accessToken;
    const createPath = `admin/${store}/users`;
    const input = { name: ' New Staff ', email: ' NEW@EXAMPLE.COM ', phone: '+20 (100) 123-4567', password: 'InitialPass123!', role: 'admin' };
    assert.equal((await f.request(createPath, { body: input })).status, 401);
    assert.equal((await f.request(`admin/${store === 'b2c' ? 'b2b' : 'b2c'}/users`, { token, body: input })).status, 401);
    for (const invalid of [{ role: 'superAdmin' }, { role: ['admin'] }, { role: null }, { role: undefined },
      { password: 'short' }, { password: 'ع'.repeat(37) }, { password: {} }, { email: 'bad' }, { name: ' ' }, { phone: 'bad' }]) {
      assert.equal((await f.request(createPath, { token, body: { ...input, ...invalid } })).status, 422);
    }
    const emailsBefore = f.emails.length;
    for (const role of ['admin', 'moderator', 'user']) {
      const email = `${role}@example.com`;
      const created = await f.request(createPath, { token, body: { ...input, email: ` ${email.toUpperCase()} `, role,
        store: 'other', status: 'blocked', emailVerified: false, authVersion: 90, passwordHash: 'injected' } });
      assert.equal(created.status, 201);
      assert.equal(created.headers.get('cache-control'), 'no-store');
      assert.equal(created.headers.get('set-cookie'), null);
      assert.deepEqual(Object.keys(created.result.data).sort(), ['id', 'store', 'name', 'email', 'phone', 'role', 'emailVerified', 'status', 'createdAt', 'deletedAt'].sort());
      assert.equal(created.result.data.email, email);
      assert.equal(created.result.data.phone, '+201001234567');
      assert.equal(created.result.data.name, 'New Staff');
      assert.equal(created.result.data.store, store);
      assert.equal(created.result.data.role, role);
      assert.equal(created.result.data.status, 'active');
      assert.equal(created.result.data.emailVerified, true);
      assert.equal(created.result.data.deletedAt, null);
      const login = await f.request(`${store}/auth/login`, { body: { email, password: input.password } });
      assert.equal(login.status, 200);
      const accountToken = login.result.data.accessToken;
      assert.equal((await f.request(createPath, { token: accountToken, body: input })).status, 403);
      if (role === 'user') {
        const changePath = `${store}/auth/change-password`;
        assert.equal((await f.request(changePath, { body: { currentPassword: input.password, newPassword: 'ChangedPass123!' } })).status, 401);
        assert.equal((await f.request(changePath, { token: accountToken, body: { currentPassword: input.password, newPassword: 'short' } })).status, 422);
        assert.equal((await f.request(changePath, { token: accountToken, body: { currentPassword: 'WrongPass123!', newPassword: 'ChangedPass123!' } })).result.code, 'INVALID_CURRENT_PASSWORD');
        const changed = await f.request(changePath, { token: accountToken, language: 'ar', body: {
          currentPassword: input.password, newPassword: 'ChangedPass123!', userId: '0'.repeat(24), email: owner.email,
        } });
        assert.equal(changed.status, 200);
        assert.equal(changed.result.code, 'PASSWORD_CHANGED');
        assert.equal(changed.result.data, null);
        assert.equal(changed.headers.get('cache-control'), 'no-store');
        assert.match(changed.result.message, /[\u0600-\u06ff]/);
        assert.ok(changed.headers.get('set-cookie').includes(`narmer_refresh_${store}=;`));
        assert.ok(changed.headers.get('set-cookie').includes('HttpOnly'));
        assert.ok(changed.headers.get('set-cookie').includes('Secure'));
        assert.equal((await f.request(`${store}/users/me`, { method: 'GET', token: accountToken })).status, 401);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal((await f.request(`${store}/auth/refresh`, { cookie, origin: 'https://shop.example' })).status, 401);
        assert.equal((await f.request(`${store}/auth/login`, { body: { email, password: input.password } })).status, 401);
        assert.equal((await f.request(`${store}/auth/login`, { body: { email, password: 'ChangedPass123!' } })).status, 200);
      }
    }
    assert.equal(f.emails.length, emailsBefore);
    const duplicate = await f.request(createPath, { token, language: 'ar', body: { ...input, email: 'ADMIN@example.com' } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.result.code, 'ACCOUNT_EMAIL_EXISTS');
    assert.match(duplicate.result.message, /[\u0600-\u06ff]/);
  }
  const logs = JSON.stringify(f.logs);
  assert.ok(!logs.includes('InitialPass123!') && !logs.includes('ChangedPass123!'));
});

test('HTTP signup/OTP/login/profile respects whitelist, cookie security, and store boundaries', async t => {
  const f = await fixture(t, { production: true });
  const input = { name: '  Customer  ', email: ' CUSTOMER@EXAMPLE.COM ', phone: '+201001234567', password: 'password123' };
  const registered = await f.request('b2c/auth/register', { body: { ...input, role: 'superAdmin', store: 'b2b' }, language: 'ar' });
  assert.equal(registered.status, 201);
  assert.match(registered.result.message, /[\u0600-\u06ff]/);
  assert.equal(f.emails.at(-1).locale, 'ar');
  const credentials = { email: 'customer@example.com', password: input.password };
  assert.equal((await f.request('b2c/auth/login', { body: credentials })).status, 403);
  assert.equal((await f.request('b2c/auth/verify-email', { body: { email: credentials.email, otp: f.emails.at(-1).code } })).status, 200);
  const login = await f.request('b2c/auth/login', { body: credentials, origin: 'https://shop.example' });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const { accessToken, user } = login.result.data;
  assert.equal(user.role, 'user');
  assert.equal(user.name, 'Customer');
  assert.equal(Object.hasOwn(login.result.data, 'refreshToken'), false);
  const cookieHeader = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/v1/b2c/auth']) assert.ok(cookieHeader.includes(flag));
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
  const profile = await f.request('b2c/users/me', { method: 'GET', token: accessToken });
  assert.equal(profile.status, 200);
  assert.equal(profile.headers.get('cache-control'), 'no-store');
  assert.equal(Object.hasOwn(profile.result.data, 'passwordHash'), false);
  assert.equal((await f.request('b2b/users/me', { method: 'GET', token: accessToken })).status, 401);
  assert.equal((await f.request('b2c/users/me', { method: 'GET' })).status, 401);
  const updated = await f.request('b2c/users/me', { method: 'PATCH', token: accessToken,
    body: { name: 'Updated', role: 'superAdmin', status: 'blocked', email: 'attacker@example.com' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.result.data.role, 'user');
  assert.equal(updated.result.data.email, credentials.email);
  assert.equal((await f.request('b2c/users/me', { method: 'PATCH', token: accessToken, body: { role: 'admin' } })).status, 422);
  assert.equal(JSON.stringify(f.logs).includes(input.password), false);
});

test('cookie refresh requires a trusted Origin, rotates, rejects replay, and logout revokes access', async t => {
  const f = await fixture(t);
  const { input } = await f.verified();
  const login = await f.request('b2c/auth/login', { body: { email: input.email, password: input.password } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('b2c/auth/refresh', { cookie })).status, 403);
  assert.equal((await f.request('b2c/auth/refresh', { cookie, origin: 'https://attacker.example' })).status, 403);
  const refreshed = await f.request('b2c/auth/refresh', { cookie, origin: 'https://shop.example' });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.headers.get('set-cookie').split(';')[0], cookie);
  assert.equal((await f.request('b2c/auth/refresh', { cookie, origin: 'https://shop.example' })).status, 401);
  const token = refreshed.result.data.accessToken;
  const logout = await f.request('b2c/auth/logout', { token });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
  assert.equal((await f.request('b2c/users/me', { method: 'GET', token })).status, 401);
});

test('missing email configuration fails clearly and malformed credentials never create an account', async t => {
  const f = await fixture(t, { emailMissing: true });
  const body = { name: 'Customer', email: 'customer@example.com', phone: '+201001234567', password: 'password123' };
  const response = await f.request('b2c/auth/register', { body });
  assert.equal(response.status, 503);
  assert.equal(response.result.code, 'EMAIL_UNAVAILABLE');
  assert.equal(f.accounts.size, 0);
  const invalid = await f.request('b2c/auth/register', { body: { ...body, email: { $ne: '' }, password: 'ع'.repeat(37) } });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.result.errors.every(error => !Object.hasOwn(error, 'value')));
});

test('email-sending rate limits return the translated error envelope', async t => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await f.request('b2c/auth/forgot-password', { body: { email: 'missing@example.com' } })).status, 200);
  }
  const blocked = await f.request('b2c/auth/resend-otp', { body: { email: 'missing@example.com' }, language: 'ar' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.result.code, 'TOO_MANY_REQUESTS');
  assert.match(blocked.result.message, /[\u0600-\u06ff]/);
  assert.ok(blocked.headers.get('ratelimit'));
});

test('HTTP address validation, phone clearing, ownership, and staff exclusion', async t => {
  const f = await fixture(t);
  const { input, user } = await f.verified();
  const login = await f.auth.login('b2c', input.email, input.password);
  const token = login.accessToken;
  const base = 'b2c/users/me/addresses';
  assert.equal((await f.request(base, { token, body: { label: 'Home' } })).status, 422);
  const added = await f.request(base, { token, body: { label: 'Home', governorate: 'Cairo',
    building: '12A', street: ' Main ', floor: 'Ground', contactPhone: '+20 (100) 987-6543', userId: 'b'.repeat(24) } });
  assert.equal(added.status, 201);
  assert.equal(added.result.data.street, 'Main');
  assert.equal(added.result.data.contactPhone, '+201009876543');
  assert.equal(Object.hasOwn(added.result.data, 'userId'), false);
  const path = `${base}/${added.result.data.id}`;
  for (const value of [null, '']) {
    const cleared = await f.request(path, { method: 'PATCH', token, body: { contactPhone: value } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.result.data.contactPhone, null);
    assert.equal(cleared.result.data.effectiveContactPhone, input.phone);
  }
  assert.equal((await f.request(path, { method: 'PATCH', token, body: { contactPhone: { $ne: '' } } })).status, 422);
  assert.equal((await f.request(`${base}/bad-id`, { method: 'GET', token })).status, 422);
  assert.equal((await f.request('b2b/users/me/addresses', { method: 'GET', token })).status, 401);
  assert.equal((await f.request(path, { method: 'DELETE', token })).status, 200);
  await f.auth.provisionSuperAdmin('b2c', input.email);
  const ownerLogin = await f.auth.login('b2c', input.email, input.password);
  assert.equal(f.accounts.get(user._id).role, 'superAdmin');
  assert.equal((await f.request(base, { method: 'GET', token: ownerLogin.accessToken })).status, 403);
});

test('dashboard routes enforce roles, safe account fields, bounded inputs, store scope, and explicit handover', async t => {
  const f = await fixture(t);
  const owner = await f.verified();
  await f.auth.provisionSuperAdmin('b2c', owner.input.email);
  const token = (await f.auth.login('b2c', owner.input.email, owner.input.password)).accessToken;
  const input = { ...owner.input, email: 'staff@example.com' };
  await f.auth.register('b2c', input, 'en');
  await f.auth.verifyEmail('b2c', input.email, f.emails.at(-1).code);
  const target = await f.users.findAccountByEmail('b2c', input.email);
  const path = `admin/b2c/users/${target._id}`;
  assert.equal((await f.request('admin/b2b/users', { method: 'GET', token })).status, 401);
  assert.equal((await f.request('admin/b2c/users?limit=101', { method: 'GET', token })).status, 422);
  assert.equal((await f.request('admin/b2c/users/bad-id', { method: 'GET', token })).status, 422);
  assert.equal((await f.request(path, { method: 'PATCH', token, body: { role: 'superAdmin' } })).status, 422);
  assert.equal((await f.request(path, { method: 'PATCH', token, body: { status: 'deleted' } })).status, 422);
  const promoted = await f.request(path, { method: 'PATCH', token,
    body: { role: 'admin', phone: '+20 (100) 123-4567', email: 'changed@example.com', passwordHash: 'evil', store: 'b2b' } });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.result.data.email, input.email);
  assert.equal(promoted.result.data.phone, '+201001234567');
  const staffToken = (await f.auth.login('b2c', input.email, input.password)).accessToken;
  assert.equal((await f.request(path, { method: 'DELETE', token: staffToken })).status, 403);
  const listed = await f.request('admin/b2c/users', { method: 'GET', token: staffToken });
  assert.equal(listed.status, 200);
  for (const item of listed.result.data.items) {
    for (const field of ['passwordHash', 'authVersion', 'addresses']) assert.equal(Object.hasOwn(item, field), false);
  }
  assert.equal((await f.request('admin/b2c/auth/super-admin/handover', { token: staffToken, body: { userId: owner.user._id } })).status, 403);
  const handover = await f.request('admin/b2c/auth/super-admin/handover', { token, body: { userId: target._id } });
  assert.equal(handover.status, 200);
  assert.equal(handover.result.data.formerSuperAdminRole, 'admin');
  assert.ok(handover.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
  assert.equal((await f.request('admin/b2c/users', { method: 'GET', token: staffToken })).status, 401);
  assert.equal((await f.request('admin/b2c/users', { method: 'GET', token })).status, 401);
});
