import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { testConfig } from './helpers/config.js';
import { identityFixture } from './helpers/identity.js';
import { cartFixture } from './helpers/cart.js';
import { leadsFixture, leadContact } from './helpers/leads.js';
import { shippingFixture } from './helpers/shipping.js';
import { ordersFixture, checkoutInput } from './helpers/orders.js';
import { salesFixture, saleInput } from './helpers/sales.js';
import { couponsFixture, couponInput } from './helpers/coupons.js';
import { notificationsFixture } from './helpers/notifications.js';
import { simpleInput } from './helpers/products.js';
import { nativeInput, offerInput } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';

test('Apidog examples exercise remaining successful routes through real HTTP serializers', async t => {
  const f = identityFixture(), p = cartFixture(f.auth), l = leadsFixture(f.auth), sh = shippingFixture(f.auth);
  const s = salesFixture(f.auth, p), c = couponsFixture(f.auth, p), n = notificationsFixture(f.auth);
  const storage = l.storage, o = ordersFixture(f.auth, p, { shipping: sh.shipping, storage });
  const staff = {}, customers = {}, ids = {}, staffIdentities = {};
  const input = { name: 'Example Customer', email: 'buyer@example.com', phone: '+201001234567', password: 'ExamplePass123!' };
  for (const store of ['b2c', 'b2b']) {
    await f.auth.register(store, { ...input, email: `staff-${store}@example.com` });
    await f.auth.verifyEmail(store, `staff-${store}@example.com`, f.emails.at(-1).code);
    await f.auth.provisionSuperAdmin(store, `staff-${store}@example.com`);
    staff[store] = (await f.auth.login(store, `staff-${store}@example.com`, input.password)).accessToken;
    staffIdentities[store] = await f.auth.authenticate(store, staff[store]);
  }
  await l.forms.update('b2b', staffIdentities.b2b, 'fabric', { version: 0, isActive: true });
  const category = await p.categories.create('b2c', staffIdentities.b2c, { name: { ar: 'ملابس', en: 'Clothing' }, slug: 'clothing' });
  const product = await p.products.create('b2c', staffIdentities.b2c, simpleInput(category.id));
  await sh.shipping.setDefault('b2c', staffIdentities.b2c, { defaultFee: 5000 });
  const sale = await s.sales.create('b2c', staffIdentities.b2c, saleInput(product.id));
  await c.coupons.create('b2c', staffIdentities.b2c, couponInput());
  const app = createApp(testConfig, { apiRouter: createBusinessRouter(testConfig, {
    users: f.users, email: f.email, repository: f.repository, userRepository: f.userRepository,
    categoryRepository: p.categoryRepository, productRepository: p.repository, shoppingRepository: p.cartRepository,
    deliveryRepository: sh.repository, campaignRepository: s.repository, discountRepository: c.repository,
    orderRepository: o.repository, proofStorage: storage, favoritesRepository: emptyWishlistRepository,
    definitionRepository: l.formRepository, offerRepository: l.wholesaleRepository, submissionRepository: l.repository,
    leadStorage: storage, staffNotificationRepository: n.repository, transaction: async work => work({}),
  }), isReady: () => true, logger: { info() {}, error() {} } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function req(path, { method = 'GET', token, body, cookie, raw, draftToken } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path.startsWith('/health/') ? path : '/api/v1/' + path}`, {
      method, headers: { Origin: testConfig.corsOrigins[0], 'X-Language': 'en', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(draftToken ? { 'X-Lead-Draft-Token': draftToken } : {}),
        ...(raw ? { 'Content-Type': 'image/png' } : body ? { 'Content-Type': 'application/json' } : {}) },
      ...(raw ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
    });
    const json = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
    assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
    return { data: json?.data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  for (const store of ['b2c', 'b2b']) {
    await req(`${store}/auth/register`, { method: 'POST', body: input });
    await req(`${store}/auth/resend-otp`, { method: 'POST', body: { email: 'missing@example.com' } });
    await req(`${store}/auth/verify-email`, { method: 'POST', body: { email: input.email, otp: f.emails.at(-1).code } });
    const session = await req(`${store}/auth/login`, { method: 'POST', body: { email: input.email, password: input.password } });
    const renewed = await req(`${store}/auth/refresh`, { method: 'POST', cookie: session.cookie });
    const token = customers[store] = renewed.data.accessToken; ids[store] = renewed.data.user.id;
    await req(`${store}/users/me`, { token });
    await req(`${store}/users/me`, { method: 'PATCH', token, body: { name: 'Example Buyer' } });
    const address = (await req(`${store}/users/me/addresses`, { method: 'POST', token,
      body: { label: 'Home', governorate: 'Cairo', building: '12', street: 'Example Street' } })).data;
    await req(`${store}/users/me/addresses`, { token });
    await req(`${store}/users/me/addresses/${address.id}`, { token });
    await req(`${store}/users/me/addresses/${address.id}`, { method: 'PATCH', token, body: { floor: '2', apartment: '3' } });
    await req(`${store}/users/me/addresses/${address.id}`, { method: 'DELETE', token });
    await req(`admin/${store}/users`, { token: staff[store] });
    await req(`admin/${store}/users/${ids[store]}`, { token: staff[store] });
    await req(`admin/${store}/users/${ids[store]}`, { method: 'PATCH', token: staff[store], body: { name: 'Example Customer' } });
    customers[store] = (await req(`${store}/auth/login`, { method: 'POST', body: { email: input.email, password: input.password } })).data.accessToken;
  }
  for (const path of [`b2c/categories/${category.id}`, `admin/b2c/categories/${category.id}`, 'admin/b2c/products',
    `admin/b2c/products/${product.id}`, `admin/b2c/sales/${sale.id}`, 'admin/b2c/coupons', 'admin/b2c/orders/settings']) {
    await req(path, { token: staff.b2c });
  }
  const fee = (await req('admin/b2c/shipping-fees', { method: 'POST', token: staff.b2c,
    body: { governorateCode: 'cairo', name: { ar: 'القاهرة', en: 'Cairo' }, fee: 5000 } })).data;
  await req('admin/b2c/shipping-fees', { token: staff.b2c });
  await req(`admin/b2c/shipping-fees/${fee.id}`, { token: staff.b2c });
  await req('admin/b2c/orders/settings', { method: 'PATCH', token: staff.b2c, body: { receivingAccount: 'example@instapay' } });
  await req('b2c/cart/items', { method: 'PUT', token: customers.b2c, body: { productId: product.id, quantity: 1 } });
  const quote = (await req('b2c/cart/checkout', { method: 'POST', token: customers.b2c, body: checkoutInput({ paymentMethod: 'instapay' }) })).data;
  const png = await sharp({ create: { width: 4, height: 5, channels: 3, background: 'white' } }).png().toBuffer();
  const proof = (await req(`b2c/cart/checkout/${quote.checkoutId}/proof`, { method: 'POST', token: customers.b2c, raw: png })).data;
  const order = (await req('b2c/cart/checkout/orders', { method: 'POST', token: customers.b2c, body: { checkoutId: quote.checkoutId, proofId: proof.id } })).data.order;
  await req(`b2c/orders/${order.id}/proof`, { token: customers.b2c });
  await req(`admin/b2c/orders/${order.id}`, { token: staff.b2c });
  await req('admin/b2c/notifications/unread-count', { token: staff.b2c });
  const feed = (await req('admin/b2c/notifications', { token: staff.b2c })).data;
  await req(`admin/b2c/notifications/${feed.items[0].id}/read`, { method: 'PATCH', token: staff.b2c });
  await req('admin/b2b/forms/fabric', { token: staff.b2b });
  const native = (await req('admin/b2b/wholesale/products', { method: 'POST', token: staff.b2b, body: nativeInput })).data;
  await req('admin/b2b/wholesale/products', { token: staff.b2b });
  await req(`admin/b2b/wholesale/products/${native.id}`, { token: staff.b2b });
  const offer = (await req('admin/b2b/wholesale/offers', { method: 'POST', token: staff.b2b, body: offerInput('b2b', native.id) })).data;
  await req('admin/b2b/wholesale/offers', { token: staff.b2b });
  await req(`admin/b2b/wholesale/offers/${offer.id}`, { token: staff.b2b });
  await req(`admin/b2b/wholesale/offers/${offer.id}`, { method: 'PATCH', token: staff.b2b, body: { version: offer.version, isActive: false } });
  const draft = (await req('b2b/leads/drafts', { method: 'POST', token: customers.b2b, body: { formType: 'fabric' } })).data;
  const lead = (await req('b2b/leads', { method: 'POST', token: customers.b2b, draftToken: draft.draftToken,
    body: { draftId: draft.draftId, formVersion: 1, contact: leadContact, answers: {} } })).data.lead;
  await req(`b2b/leads/${lead.id}`, { token: customers.b2b });
  for (const store of ['b2c', 'b2b']) {
    await req(`${store}/auth/logout`, { method: 'POST', token: customers[store] });
    await req(`${store}/auth/forgot-password`, { method: 'POST', body: { email: input.email } });
    await req(`${store}/auth/reset-password`, { method: 'POST', body: { email: input.email, otp: f.emails.at(-1).code, password: 'ChangedPass123!' } });
    await req(`admin/${store}/users/${ids[store]}`, { method: 'DELETE', token: staff[store] });
    const email = `replacement-${store}@example.com`;
    await f.auth.register(store, { ...input, email }); await f.auth.verifyEmail(store, email, f.emails.at(-1).code);
    const replacement = await f.users.findAccountByEmail(store, email);
    await req(`admin/${store}/auth/super-admin/handover`, { method: 'POST', token: staff[store], body: { userId: String(replacement._id) } });
  }
  await req('/health/live'); await req('/health/ready');
});
