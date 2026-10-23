import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { createUsersService } from '../src/modules/users/users.service.js';
import { createStaffUsersService } from '../src/modules/users/users.staff.service.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';
import { AuthChallenge, AuthSession, SuperAdminAssignment } from '../src/modules/auth/auth.model.js';
import { testConfig } from './helpers/config.js';
import { categoriesRepository } from '../src/modules/categories/categories.repository.js';
import { createCategoriesService } from '../src/modules/categories/categories.service.js';
import { createProductsService } from '../src/modules/products/products.service.js';
import { productsRepository } from '../src/modules/products/products.repository.js';
import { simpleInput, variantInput } from './helpers/products.js';
import { Media } from '../src/modules/media/media.model.js';
import { mediaRepository } from '../src/modules/media/media.repository.js';
import { createMediaService } from '../src/modules/media/media.service.js';
import { mediaFixture } from './helpers/media.js';
import { createShippingService } from '../src/modules/shipping/shipping.service.js';
import { shippingRepository } from '../src/modules/shipping/shipping.repository.js';
import { ShippingFee, ShippingSettings } from '../src/modules/shipping/shipping.model.js';
import { Cart } from '../src/modules/cart/cart.model.js';
import { cartRepository } from '../src/modules/cart/cart.repository.js';
import { createCartService, guestCartLifetimeMs } from '../src/modules/cart/cart.service.js';
import { createSalesService } from '../src/modules/sales/sales.service.js';
import { salesRepository } from '../src/modules/sales/sales.repository.js';
import { Sale, SaleAudit } from '../src/modules/sales/sales.model.js';
import { saleInput as fixedSaleInput } from './helpers/sales.js';
import { createCouponsService } from '../src/modules/coupons/coupons.service.js';
import { couponsRepository } from '../src/modules/coupons/coupons.repository.js';
import { Coupon, CouponRedemption, CouponAudit } from '../src/modules/coupons/coupons.model.js';
import { couponInput } from './helpers/coupons.js';
import { runTransaction } from '../src/shared/utils/transaction.js';
import { createOrdersService } from '../src/modules/orders/orders.service.js';
import { ordersRepository } from '../src/modules/orders/orders.repository.js';
import { Order,OrderProof,OrderAudit } from '../src/modules/orders/orders.model.js';
import { checkoutInput } from './helpers/orders.js';
import { Wishlist } from '../src/modules/wishlist/wishlist.model.js';
import { wishlistRepository } from '../src/modules/wishlist/wishlist.repository.js';
import { createWishlistService } from '../src/modules/wishlist/wishlist.service.js';
import { FormDefinition, FormAudit } from '../src/modules/forms/forms.model.js';
import { formsRepository } from '../src/modules/forms/forms.repository.js';
import { createFormsService } from '../src/modules/forms/forms.service.js';
import { textField, choiceField } from './helpers/forms.js';
import { WholesaleProduct, WholesaleOffer, WholesaleAudit } from '../src/modules/wholesale/wholesale.model.js';
import { wholesaleRepository } from '../src/modules/wholesale/wholesale.repository.js';
import { createWholesaleService } from '../src/modules/wholesale/wholesale.service.js';
import { nativeInput, offerInput } from './helpers/wholesale.js';
import { Lead, LeadDraft, LeadImage, LeadAudit } from '../src/modules/leads/leads.model.js';
import { leadsRepository } from '../src/modules/leads/leads.repository.js';
import { createLeadsService } from '../src/modules/leads/leads.service.js';
import { leadContact } from './helpers/leads.js';

// Opt in only with an explicit test server URI. Never use MONGODB_URI or another project's database.
const uri = process.env.NARMER_TEST_MONGODB_URI;
test('real MongoDB enforces identity, catalogs, commerce, Forms, Wholesale and Leads integrity', { skip: !uri }, async t => {
  const campaignAt = Date.now();
  const saleInput = productId => ({ ...fixedSaleInput(productId),
    startsAt: new Date(campaignAt - 3600000).toISOString(), endsAt: new Date(campaignAt + 86400000).toISOString() });
  const databaseName = `narmer_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
  t.after(async () => {
    try {
      assert.equal(mongoose.connection.name, databaseName);
      assert.match(databaseName, /^narmer_test_[a-f0-9]{24}$/);
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      for (const collection of collections) await mongoose.connection.db.dropCollection(collection.name);
      assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
    } finally { await mongoose.disconnect(); }
  });
  await usersRepository.initialize();
  await authRepository.initialize();
  const messages = [];
  const users = createUsersService();
  const auth = createAuthService(testConfig, { users, email: {
    assertReady() {}, async sendOtp(message) { messages.push(message); },
  } });
  const input = { name: 'Customer', email: 'customer@example.com', phone: '+201001234567', password: 'password123' };
  await auth.register('b2c', input, 'en');
  await auth.register('b2b', input, 'en');
  const user = await users.findAccountByEmail('b2c', input.email);
  await assert.rejects(users.registerAccount('b2c', input, 'hash'), { code: 11000 });
  const otp = messages.find(message => message.store === 'b2c').code;
  const verified = await Promise.allSettled([
    auth.verifyEmail('b2c', input.email, otp), auth.verifyEmail('b2c', input.email, otp),
  ]);
  assert.equal(verified.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await users.findAccountByEmail('b2b', input.email)).emailVerifiedAt, null);
  const login = await auth.login('b2c', input.email, input.password);
  const rotated = await Promise.allSettled([
    auth.refresh('b2c', login.refreshToken), auth.refresh('b2c', login.refreshToken),
  ]);
  assert.equal(rotated.filter(result => result.status === 'fulfilled').length, 1);
  await SuperAdminAssignment.create({ store: 'b2c', userId: user._id });
  await assert.rejects(SuperAdminAssignment.create({ store: 'b2c', userId: user._id }), { code: 11000 });
  const session = await AuthSession.findOne({ store: 'b2c', userId: user._id });
  assert.equal(session.refreshDigest.includes('.'), false);
  const challenge = await AuthChallenge.findOne({ store: 'b2c', userId: user._id });
  assert.ok(challenge.consumedAt);
  await SuperAdminAssignment.deleteOne({ store: 'b2c' });
  const addresses = await Promise.all([1, 2].map(() => users.addAddress('b2c', user._id,
    { label: 'Home', governorate: 'Cairo', building: '12A', street: 'Main' })));
  assert.equal((await users.listAddresses('b2c', user._id)).length, 2);
  await Promise.all([
    users.updateAddress('b2c', user._id, addresses[0].id, { floor: 'Ground' }),
    users.updateAddress('b2c', user._id, addresses[0].id, { apartment: '12B' }),
  ]);
  const updatedAddress = await users.getAddress('b2c', user._id, addresses[0].id);
  assert.equal(updatedAddress.floor, 'Ground');
  assert.equal(updatedAddress.apartment, '12B');
  const provisioned = await Promise.allSettled([
    auth.provisionSuperAdmin('b2c', input.email), auth.provisionSuperAdmin('b2c', input.email),
  ]);
  assert.equal(provisioned.filter(result => result.status === 'fulfilled').length, 1);
  const staff = createStaffUsersService({ auth });
  const ownerLogin = await auth.login('b2c', input.email, input.password);
  const identity = await auth.authenticate('b2c', ownerLogin.accessToken);
  const candidates = [];
  for (const email of ['next@example.com', 'alternate@example.com']) {
    const candidate = await users.registerAccount('b2c', { ...input, email }, user.passwordHash);
    await users.confirmEmail('b2c', candidate._id, new Date());
    candidates.push(candidate);
  }
  const failingAuth = createAuthService(testConfig, { users: { ...users,
    async recordStaffChange() { throw new Error('audit failed'); },
  }, email: null });
  await assert.rejects(failingAuth.handoverSuperAdmin('b2c', identity, candidates[0]._id), /audit failed/);
  assert.equal(String((await authRepository.findAssignment('b2c')).userId), String(user._id));
  assert.equal((await users.findAccountById('b2c', user._id)).role, 'superAdmin');
  assert.equal((await users.findAccountById('b2c', candidates[0]._id)).role, 'user');
  const results = await Promise.allSettled(candidates.map(candidate => auth.handoverSuperAdmin('b2c', identity, candidate._id)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const assignment = await authRepository.findAssignment('b2c');
  const holder = await users.findAccountById('b2c', assignment.userId);
  assert.equal(holder.role, 'superAdmin');
  assert.equal((await users.findAccountById('b2c', user._id)).role, 'admin');
  await assert.rejects(auth.authenticate('b2c', ownerLogin.accessToken), { code: 'UNAUTHORIZED' });
  const newLogin = await auth.login('b2c', holder.email, input.password);
  const newIdentity = await auth.authenticate('b2c', newLogin.accessToken);
  await categoriesRepository.initialize();
  const categories = createCategoriesService({ auth });
  const categoryInput = slug => ({ name: { ar: 'تصنيف', en: slug }, slug });
  const roots = [];
  for (const slug of ['root-a', 'root-b']) roots.push(await categories.create('b2c', newIdentity, categoryInput(slug)));
  const moved = await Promise.allSettled([
    categories.update('b2c', newIdentity, roots[0].id, { parentId: roots[1].id }),
    categories.update('b2c', newIdentity, roots[1].id, { parentId: roots[0].id }),
  ]);
  assert.equal(moved.filter(result => result.status === 'fulfilled').length, 1);
  const parent = await categories.create('b2c', newIdentity, categoryInput('parent'));
  const parentRace = await Promise.allSettled([
    categories.remove('b2c', newIdentity, parent.id),
    categories.create('b2c', newIdentity, { ...categoryInput('child'), parentId: parent.id }),
  ]);
  assert.equal(parentRace.filter(result => result.status === 'fulfilled').length, 1);
  const rows = await categoriesRepository.all('b2c');
  const ids = new Set(rows.map(row => String(row._id)));
  for (const row of rows) if (row.parentId) assert.ok(ids.has(String(row.parentId)));
  const failingCategories = createCategoriesService({ auth, repository: { ...categoriesRepository,
    async audit() { throw new Error('audit failed'); },
  } });
  await assert.rejects(failingCategories.create('b2c', newIdentity, categoryInput('rollback')), /audit failed/);
  assert.equal((await categoriesRepository.all('b2c')).some(row => row.slug === 'rollback'), false);
  await productsRepository.initialize();
  let products;
  const catalogCategories = createCategoriesService({ auth, products: {
    hasAssignedCategory: (...args) => products.hasAssignedCategory(...args),
  } });
  products = createProductsService({ auth, categories: catalogCategories });
  const productCategory = await catalogCategories.create('b2c', newIdentity, categoryInput('products'));
  const simple = await products.create('b2c', newIdentity, { ...simpleInput(productCategory.id), sku: 'shared-sku' });
  await products.create('b2c', newIdentity, simpleInput(productCategory.id, 'without-sku-one'));
  await products.create('b2c', newIdentity, simpleInput(productCategory.id, 'without-sku-two'));
  const variantData = variantInput(productCategory.id);
  variantData.variants[0].sku = 'SHARED-SKU';
  await assert.rejects(products.create('b2c', newIdentity, variantData), { code: 'PRODUCT_SKU_EXISTS' });
  variantData.variants[0].sku = 'variant-sku';
  const variant = await products.create('b2c', newIdentity, variantData);
  const updatedVariant = await products.update('b2c', newIdentity, variant.id, { version: 0, name: { ar: 'جديد' } });
  assert.equal(updatedVariant.variants[0].id, variant.variants[0].id);
  assert.deepEqual(updatedVariant.variants[0].values, { size: 'small' });
  const productUpdates = await Promise.allSettled([
    products.update('b2c', newIdentity, simple.id, { version: 0, stock: 1 }),
    products.update('b2c', newIdentity, simple.id, { version: 0, stock: 2 }),
  ]);
  assert.equal(productUpdates.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(catalogCategories.remove('b2c', newIdentity, productCategory.id), { code: 'CATEGORY_HAS_PRODUCTS' });
  await catalogCategories.update('b2c', newIdentity, productCategory.id, { isActive: false });
  await assert.rejects(products.getPublic('b2c', simple.id, 'en'), { code: 'PRODUCT_NOT_FOUND' });
  const raceCategory = await catalogCategories.create('b2c', newIdentity, categoryInput('product-race'));
  const assignmentRace = await Promise.allSettled([
    catalogCategories.remove('b2c', newIdentity, raceCategory.id),
    products.create('b2c', newIdentity, simpleInput(raceCategory.id, 'racing-product')),
  ]);
  assert.equal(assignmentRace.filter(result => result.status === 'fulfilled').length, 1);
  const actualCategories = new Set((await categoriesRepository.all('b2c')).map(row => String(row._id)));
  const [actualProducts] = await productsRepository.list('b2c', { page: 1, limit: 100 });
  for (const product of actualProducts) assert.ok(actualCategories.has(String(product.categoryId)));
  const failingProducts = createProductsService({ auth, categories: catalogCategories, repository: { ...productsRepository,
    async audit() { throw new Error('audit failed'); },
  } });
  await assert.rejects(failingProducts.create('b2c', newIdentity, simpleInput(productCategory.id, 'product-rollback')), /audit failed/);
  assert.equal((await productsRepository.list('b2c', { page: 1, limit: 100 }))[0].some(row => row.slug === 'product-rollback'), false);
  await mediaRepository.initialize();
  const fakeStorage = mediaFixture();
  const media = createMediaService({ auth, storage: fakeStorage.storage, logger: { error() {} }, targets: {
    product: { getStaff: (...args) => products.getStaff(...args) },
    category: { getStaff: (...args) => catalogCategories.getStaff(...args) },
  } });
  products = createProductsService({ auth, categories: catalogCategories, media });
  const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
  const image = await media.upload('b2c', newIdentity, 'product', variant.id, png, 'image/png');
  assert.equal((await Media.findById(image.id)).status, 'ready');
  const imageFailure = createProductsService({ auth, categories: catalogCategories, media, repository: {
    ...productsRepository, async audit() { throw new Error('audit failed'); },
  } });
  await assert.rejects(imageFailure.update('b2c', newIdentity, variant.id,
    { version: 1, imageIds: [image.id] }), /audit failed/);
  assert.equal((await Media.findById(image.id)).status, 'ready');
  assert.equal((await productsRepository.findById('b2c', variant.id)).images.length, 0);
  const withImage = await products.update('b2c', newIdentity, variant.id, { version: 1, imageIds: [image.id] });
  assert.deepEqual(withImage.images, [image]);
  assert.equal((await Media.findById(image.id)).status, 'attached');
  await assert.rejects(products.update('b2c', newIdentity, simple.id,
    { version: 1, imageIds: [image.id] }), { code: 'MEDIA_CONFLICT' });
  const imageCategory = createCategoriesService({ auth, media });
  const categoryImage = await media.upload('b2c', newIdentity, 'category', productCategory.id, png, 'image/png');
  await imageCategory.update('b2c', newIdentity, productCategory.id, { imageId: categoryImage.id });
  fakeStorage.failRemove(true);
  await products.update('b2c', newIdentity, variant.id, { version: 2, imageIds: [] });
  assert.equal((await Media.findById(image.id)).status, 'deletePending');
  fakeStorage.failRemove(false);
  assert.equal((await media.cleanup()).removed, 1);
  assert.equal(await Media.findById(image.id), null);
  assert.equal((await Media.findById(categoryImage.id)).status, 'attached');
  await imageCategory.update('b2c', newIdentity, productCategory.id, { imageId: null });
  assert.equal(await Media.findById(categoryImage.id), null);
  const staleImage = await media.upload('b2c', newIdentity, 'product', variant.id, png, 'image/png');
  await Media.updateOne({ _id: staleImage.id }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(products.update('b2c', newIdentity, variant.id,
    { version: 3, imageIds: [staleImage.id] }), { code: 'MEDIA_CONFLICT' });
  assert.equal((await media.cleanup()).removed, 1);
  await products.remove('b2c', newIdentity, simple.id);
  assert.equal(await productsRepository.findById('b2c', simple.id), null);
  await shippingRepository.initialize();
  const shipping = createShippingService({ auth });
  assert.equal((await shipping.resolve('b2c', 'giza')).fee, 5000);
  await shippingRepository.initialize();
  assert.equal(await ShippingSettings.countDocuments({ _id: 'b2c' }), 1);
  const adminLogin = await auth.login('b2c', user.email, input.password);
  const adminIdentity = await auth.authenticate('b2c', adminLogin.accessToken);
  assert.equal(adminIdentity.role, 'admin');
  // Simulate missing settings to retain coverage for concurrent first-time dashboard setup.
  await ShippingSettings.deleteOne({ _id: 'b2c' });
  await assert.rejects(shipping.resolve('b2c', 'giza'), { code: 'SHIPPING_NOT_CONFIGURED' });
  const defaultWrites = await Promise.allSettled([
    shipping.setDefault('b2c', newIdentity, { defaultFee: 6700 }),
    shipping.setDefault('b2c', adminIdentity, { defaultFee: 6800 }),
  ]);
  assert.ok(defaultWrites.some(result => result.status === 'fulfilled'));
  for (const result of defaultWrites) if (result.status === 'rejected') assert.equal(result.reason.code, 'SHIPPING_CONFLICT');
  assert.equal(await ShippingSettings.countDocuments({ _id: 'b2c' }), 1);
  const configuredFee = (await shipping.getDefault('b2c', newIdentity)).defaultFee;
  assert.ok([6700, 6800].includes(configuredFee));
  await shippingRepository.initialize();
  assert.equal((await shipping.getDefault('b2c', newIdentity)).defaultFee, configuredFee);
  const overrideInput = { governorateCode: 'cairo', name: { ar: 'القاهرة', en: 'Cairo' }, fee: 0 };
  const duplicates = await Promise.allSettled([
    shipping.create('b2c', newIdentity, overrideInput), shipping.create('b2c', adminIdentity, overrideInput),
  ]);
  assert.equal(duplicates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(duplicates.find(result => result.status === 'rejected').reason.code, 'SHIPPING_FEE_EXISTS');
  assert.equal(await ShippingFee.countDocuments({ store: 'b2c', governorateCode: 'cairo' }), 1);
  const override = duplicates.find(result => result.status === 'fulfilled').value;
  assert.equal((await shipping.resolve('b2c', 'CAIRO')).fee, 0);
  const edited = await shipping.update('b2c', adminIdentity, override.id, { name: { ar: 'القاهرة الكبرى' } });
  assert.equal(edited.name.en, 'Cairo');
  const failingShipping = createShippingService({ auth, repository: { ...shippingRepository,
    async audit() { throw new Error('audit failed'); },
  } });
  await assert.rejects(failingShipping.setDefault('b2c', adminIdentity, { defaultFee: 1 }), /audit failed/);
  await assert.rejects(failingShipping.remove('b2c', adminIdentity, override.id), /audit failed/);
  assert.equal((await shipping.getDefault('b2c', newIdentity)).defaultFee, configuredFee);
  assert.equal((await shipping.getStaff('b2c', newIdentity, override.id)).fee, 0);
  const addressesBefore = (await users.findAccountById('b2c', user._id)).addresses;
  await shipping.remove('b2c', adminIdentity, override.id);
  assert.equal((await shipping.resolve('b2c', 'cairo')).fee, configuredFee);
  assert.deepEqual((await users.findAccountById('b2c', user._id)).addresses, addressesBefore);
  await cartRepository.initialize();
  let cart;
  products = createProductsService({ auth, categories: catalogCategories,
    references: { hasProductReferences: (...args) => cart.hasProductReferences(...args) } });
  cart = createCartService({ auth, products });
  const cartEmail = 'cart-customer@example.com';
  await auth.register('b2c', { ...input, email: cartEmail }, 'en');
  await auth.verifyEmail('b2c', cartEmail, messages.at(-1).code);
  const customer = { identity: await auth.authenticate('b2c', (await auth.login('b2c', cartEmail, input.password)).accessToken) };
  const guest = { guestToken: 'm'.repeat(43) };
  const emptyCart = { items: [], itemCount: 0, subtotal: 0, currency: 'EGP', canCheckout: false };
  assert.deepEqual(await Promise.all([cart.get('b2c', guest), cart.get('b2c', guest)]), [emptyCart, emptyCart]);
  assert.equal(await Cart.countDocuments({ store: 'b2c' }), 1);
  const createdGuest = await Cart.findOne({ store: 'b2c' }).lean();
  await cart.get('b2c', guest);
  const sameGuest = await Cart.findById(createdGuest._id).lean();
  assert.equal(sameGuest.version, createdGuest.version);
  assert.equal(sameGuest.expiresAt.getTime(), createdGuest.expiresAt.getTime());
  assert.deepEqual(await cart.get('b2c', customer), emptyCart);
  assert.equal(await Cart.countDocuments({ store: 'b2c' }), 2);
  assert.equal((await Cart.findOne({ ownerKey: `u:${customer.identity.userId}` }).lean()).expiresAt, null);
  const cartCategory = await catalogCategories.create('b2c', newIdentity, categoryInput('cart-catalog'));
  const cartSimple = await products.create('b2c', newIdentity, simpleInput(cartCategory.id, 'cart-simple'));
  const cartVariant = await products.create('b2c', newIdentity, variantInput(cartCategory.id, 'cart-variants'));
  const itemWrites = await Promise.allSettled([
    cart.setItem('b2c', guest, { productId: cartSimple.id, quantity: 2 }),
    cart.setItem('b2c', guest, { productId: cartVariant.id, variantId: cartVariant.variants[0].id, quantity: 1 }),
  ]);
  assert.equal(itemWrites.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal((await cart.get('b2c', guest)).items.length, 2);
  assert.equal((await products.getPublic('b2c', cartSimple.id, 'en')).stock, 10);
  await assert.rejects(products.remove('b2c', newIdentity, cartSimple.id), { code: 'PRODUCT_REFERENCED' });
  const merges = await Promise.all([
    cart.merge('b2c', customer, guest.guestToken), cart.merge('b2c', customer, guest.guestToken),
  ]);
  assert.ok(merges.every(result => result.itemCount === 3));
  assert.equal((await cart.get('b2c', guest)).items.length, 0);
  assert.equal(await Cart.countDocuments({ store: 'b2c', ownerKey: `u:${customer.identity.userId}` }), 1);
  await cart.setItem('b2c', guest, { productId: cartSimple.id, quantity: 9 });
  await assert.rejects(cart.merge('b2c', customer, guest.guestToken), { code: 'CART_MERGE_UNAVAILABLE' });
  assert.equal((await cart.get('b2c', guest)).items[0].quantity, 9);
  assert.equal((await cart.get('b2c', customer)).itemCount, 3);
  const failingCart = createCartService({ auth, products, repository: { ...cartRepository,
    async remove() { throw new Error('cart deletion failed'); },
  } });
  await cart.setItem('b2c', guest, { productId: cartSimple.id, quantity: 1 });
  await assert.rejects(failingCart.merge('b2c', customer, guest.guestToken), /cart deletion failed/);
  assert.equal((await cart.get('b2c', customer)).itemCount, 3);
  assert.equal((await cart.get('b2c', guest)).items[0].quantity, 1);
  await cart.clear('b2c', guest);
  const racingProduct = await products.create('b2c', newIdentity, simpleInput(cartCategory.id, 'cart-delete-race'));
  const deleteRace = await Promise.allSettled([
    cart.setItem('b2c', guest, { productId: racingProduct.id, quantity: 1 }),
    products.remove('b2c', newIdentity, racingProduct.id),
  ]);
  assert.equal(deleteRace.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of deleteRace) if (result.status === 'rejected') assert.ok(['PRODUCT_NOT_FOUND', 'PRODUCT_REFERENCED'].includes(result.reason.code));
  if ((await cart.get('b2c', guest)).items.length) assert.ok(await productsRepository.findById('b2c', racingProduct.id));
  await cart.clear('b2c', guest);
  const racingVariant = await products.create('b2c', newIdentity, variantInput(cartCategory.id, 'cart-variant-race'));
  const variantRace = await Promise.allSettled([
    cart.setItem('b2c', guest, { productId: racingVariant.id, variantId: racingVariant.variants[0].id, quantity: 1 }),
    products.update('b2c', newIdentity, racingVariant.id, { version: 0, variants: [racingVariant.variants[1]] }),
  ]);
  assert.equal(variantRace.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of variantRace) if (result.status === 'rejected') assert.ok(['CART_VARIANT_NOT_FOUND', 'PRODUCT_REFERENCED'].includes(result.reason.code));
  const variantCart = await cart.get('b2c', guest);
  if (variantCart.items.length) assert.equal(variantCart.items[0].status, 'available');
  await cart.clear('b2c', guest);
  const expiringProduct = await products.create('b2c', newIdentity, simpleInput(cartCategory.id, 'cart-expiry'));
  await cart.setItem('b2c', guest, { productId: expiringProduct.id, quantity: 1 });
  const storedGuest = await Cart.findOne({ store: 'b2c', ownerKey: /^g:/ });
  assert.ok(storedGuest.expiresAt.getTime() <= Date.now() + guestCartLifetimeMs);
  await Cart.updateOne({ _id: storedGuest._id }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await cart.get('b2c', guest)).items.length, 0);
  await products.remove('b2c', newIdentity, expiringProduct.id);
  await cart.setItem('b2c', guest, { productId: cartSimple.id, quantity: 1 });
  assert.equal((await cart.get('b2c', guest)).items.length, 1);
  const duplicateOwner = { store: 'b2c', ownerKey: `u:${customer.identity.userId}` };
  await assert.rejects(Cart.create(duplicateOwner), { code: 11000 });
  const cartIndexes = await Cart.collection.indexes();
  assert.ok(cartIndexes.some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
  await salesRepository.initialize();
  let sales;
  const campaignCategories = createCategoriesService({ auth, products: { hasAssignedCategory: (...args) => products.hasAssignedCategory(...args) },
    sales: { validateCatalog: (...args) => sales.validateCatalog(...args), hasCategoryReferences: (...args) => sales.hasCategoryReferences(...args) } });
  const campaignHooks = { applyPrices: (...args) => sales.applyPrices(...args), validateCatalog: (...args) => sales.validateCatalog(...args) };
  products = createProductsService({ auth, categories: campaignCategories, sales: campaignHooks,
    references: { async hasProductReferences(store, id, variants, session) {
      return await cart.hasProductReferences(store, id, variants, session)
        || (!variants && Boolean(await sales.hasProductReferences(store, id, session)));
    } } });
  sales = createSalesService({ auth, categories: campaignCategories, products });
  cart = createCartService({ auth, products });
  const saleRoot = await campaignCategories.create('b2c', newIdentity, categoryInput('sale-root'));
  const saleChild = await campaignCategories.create('b2c', newIdentity, { ...categoryInput('sale-child'), parentId: saleRoot.id });
  const saleOther = await campaignCategories.create('b2c', newIdentity, categoryInput('sale-other'));
  const saleProduct = await products.create('b2c', newIdentity, { ...simpleInput(saleChild.id, 'sale-product'), discountedPrice: 10000 });
  const saleVariant = await products.create('b2c', newIdentity, variantInput(saleChild.id, 'sale-variants'));
  const categoryCampaign = { ...saleInput(saleProduct.id), targetType: 'category', productIds: [], categoryId: saleRoot.id };
  const saleRace = await Promise.allSettled([sales.create('b2c', newIdentity, categoryCampaign), sales.create('b2c', adminIdentity, saleInput(saleProduct.id))]);
  assert.equal(saleRace.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(saleRace.find(row => row.status === 'rejected').reason.code, 'SALE_OVERLAP');
  await sales.remove('b2c', newIdentity, saleRace.find(row => row.status === 'fulfilled').value.id);
  const campaign = await sales.create('b2c', adminIdentity, categoryCampaign);
  assert.equal((await products.getPublic('b2c', saleProduct.id, 'en')).effectivePrice, 20000);
  assert.equal((await products.getStaff('b2c', newIdentity, saleProduct.id)).discountedPrice, 10000);
  assert.deepEqual((await products.getPublic('b2c', saleVariant.id, 'en')).variants.map(row => row.effectivePrice), [20000, 24000]);
  await cart.setItem('b2c', guest, { productId: saleProduct.id, quantity: 2 });
  assert.equal((await cart.get('b2c', guest)).items.find(row => row.productId === saleProduct.id).lineTotal, 40000);
  const failingSales = createSalesService({ auth, categories: campaignCategories, products,
    repository: { ...salesRepository, async audit() { throw new Error('audit failed'); } } });
  const auditCount = await SaleAudit.countDocuments();
  await assert.rejects(failingSales.update('b2c', adminIdentity, campaign.id, { discountValue: 50 }), /audit failed/);
  await assert.rejects(failingSales.remove('b2c', newIdentity, campaign.id), /audit failed/);
  await assert.rejects(failingSales.create('b2c', adminIdentity, { ...saleInput(saleProduct.id), isEnabled: false }), /audit failed/);
  assert.equal(await SaleAudit.countDocuments(), auditCount);
  assert.equal((await sales.getStaff('b2c', newIdentity, campaign.id)).discountValue, 20);
  await sales.update('b2c', adminIdentity, campaign.id, { isEnabled: false });
  assert.equal((await products.getPublic('b2c', saleProduct.id, 'en')).effectivePrice, 10000);
  assert.equal((await cart.get('b2c', guest)).items.find(row => row.productId === saleProduct.id).activeSale, null);
  const selectedSale = await sales.create('b2c', adminIdentity, saleInput(saleProduct.id));
  const otherSale = await sales.create('b2c', adminIdentity, { ...categoryCampaign, categoryId: saleOther.id });
  await assert.rejects(products.update('b2c', newIdentity, saleProduct.id, { version: 0, categoryId: saleOther.id }), { code: 'SALE_OVERLAP' });
  await assert.rejects(campaignCategories.update('b2c', newIdentity, saleChild.id, { parentId: saleOther.id }), { code: 'SALE_OVERLAP' });
  await assert.rejects(campaignCategories.remove('b2c', newIdentity, saleOther.id), { code: 'CATEGORY_HAS_SALES' });
  await cart.clear('b2c', guest);
  await sales.update('b2c', adminIdentity, selectedSale.id, { isEnabled: false });
  await assert.rejects(products.remove('b2c', newIdentity, saleProduct.id), { code: 'PRODUCT_REFERENCED' });
  await sales.remove('b2c', newIdentity, selectedSale.id);
  await products.remove('b2c', newIdentity, saleProduct.id);
  await sales.remove('b2c', newIdentity, otherSale.id);
  await campaignCategories.remove('b2c', newIdentity, saleOther.id);
  assert.equal(await Sale.countDocuments(), 1);
  await couponsRepository.initialize();
  let coupons;
  const couponCategories = createCategoriesService({ auth, sales,
    products: { hasAssignedCategory: (...args) => products.hasAssignedCategory(...args) },
    coupons: { hasCategoryReferences: (...args) => coupons.hasCategoryReferences(...args) } });
  products = createProductsService({ auth, categories: couponCategories, sales,
    references: { async hasProductReferences(store, id, variants, session) {
      return await cart.hasProductReferences(store, id, variants, session)
        || (!variants && Boolean(await sales.hasProductReferences(store, id, session)))
        || (!variants && Boolean(await coupons.hasProductReferences(store, id, session)));
    } } });
  cart = createCartService({ auth, products });
  coupons = createCouponsService({ auth, identitySecret: testConfig.couponIdentitySecret, categories: couponCategories, products, cart });
  const couponRoot = await couponCategories.create('b2c', newIdentity, categoryInput('coupon-root'));
  const couponChild = await couponCategories.create('b2c', newIdentity, { ...categoryInput('coupon-child'), parentId: couponRoot.id });
  const couponProduct = await products.create('b2c', newIdentity, simpleInput(couponChild.id, 'coupon-product'));
  const couponOther = await products.create('b2c', newIdentity, simpleInput(couponChild.id, 'coupon-other'));
  await cart.clear('b2c', guest);
  await cart.setItem('b2c', guest, { productId: couponProduct.id, quantity: 2 });
  const limited = await coupons.create('b2c', adminIdentity, couponInput({ code: 'LIMITED', targetType: 'category', categoryId: couponRoot.id,
    minimumSpend: 50000, maxUses: 2, maxUsesPerPerson: 1 }));
  assert.equal((await coupons.preview('b2c', guest, 'limited', '01001234567')).discountAmount, 10000);
  assert.equal((await coupons.getStaff('b2c', newIdentity, limited.id)).usedCount, 0);
  const redeem = (phone, orderId, code = limited.code) => runTransaction(session => coupons.redeem('b2c', guest, code, phone,
    { session, orderId, at: new Date() }));
  const phoneRace = await Promise.allSettled([redeem('0100 123 4567', '7'.repeat(24)), redeem('+20 (100) 123-4567', '8'.repeat(24))]);
  assert.equal(phoneRace.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(phoneRace.find(row => row.status === 'rejected').reason.code, 'COUPON_PERSON_LIMIT_REACHED');
  assert.equal(await CouponRedemption.countDocuments({ couponId: limited.id }), 1);
  assert.equal((await Coupon.findById(limited.id).lean()).usedCount, 1);
  const recorded = await CouponRedemption.findOne({ couponId: limited.id }).lean();
  await assert.rejects(redeem('+201001234567', String(recorded.orderId)), { code: 'COUPON_ALREADY_REDEEMED' });
  await assert.rejects(runTransaction(async session => {
    await coupons.redeem('b2c', guest, 'LIMITED', '+201009876543', { session, orderId: '9'.repeat(24) });
    throw new Error('order failed');
  }), /order failed/);
  assert.equal(await CouponRedemption.countDocuments({ couponId: limited.id }), 1);
  assert.equal((await coupons.getStaff('b2c', newIdentity, limited.id)).usedCount, 1);
  const totalRace = await Promise.allSettled([redeem('+201009876543', '9'.repeat(24)), redeem('+201007654321', 'a'.repeat(24))]);
  assert.equal(totalRace.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(totalRace.find(row => row.status === 'rejected').reason.code, 'COUPON_UNAVAILABLE');
  assert.equal((await coupons.getStaff('b2c', newIdentity, limited.id)).status, 'exhausted');
  await assert.rejects(coupons.remove('b2c', newIdentity, limited.id), { code: 'COUPON_REFERENCED' });
  const codeRace = await Promise.allSettled([coupons.create('b2c', adminIdentity, couponInput()), coupons.create('b2c', newIdentity, couponInput({ code: ' welcome20 ' }))]);
  assert.equal(codeRace.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(codeRace.find(row => row.status === 'rejected').reason.code, 'COUPON_CODE_EXISTS');
  const ordinary = codeRace.find(row => row.status === 'fulfilled').value;
  await sales.create('b2c', adminIdentity, saleInput(couponProduct.id));
  await cart.setItem('b2c', guest, { productId: couponOther.id, quantity: 1 });
  const mixedCoupon = await coupons.preview('b2c', guest, ordinary.code, '+201001234567');
  assert.equal(mixedCoupon.subtotal, 65000); assert.equal(mixedCoupon.eligibleSubtotal, 25000);
  assert.deepEqual(mixedCoupon.allocations.map(row => row.discountAmount), [0, 5000]);
  const failingCoupons = createCouponsService({ auth, identitySecret: testConfig.couponIdentitySecret, categories: couponCategories, products, cart,
    repository: { ...couponsRepository, async audit() { throw new Error('audit failed'); } } });
  const couponAudits = await CouponAudit.countDocuments();
  await assert.rejects(failingCoupons.update('b2c', adminIdentity, ordinary.id, { discountValue: 50 }), /audit failed/);
  await assert.rejects(failingCoupons.remove('b2c', newIdentity, ordinary.id), /audit failed/);
  assert.equal(await CouponAudit.countDocuments(), couponAudits);
  assert.equal((await coupons.getStaff('b2c', newIdentity, ordinary.id)).discountValue, 20);
  await cart.clear('b2c', guest);
  await coupons.update('b2c', adminIdentity, ordinary.id, { targetType: 'products', productIds: [couponOther.id], isEnabled: false });
  await assert.rejects(products.remove('b2c', newIdentity, couponOther.id), { code: 'PRODUCT_REFERENCED' });
  const emptyCouponCategory = await couponCategories.create('b2c', newIdentity, categoryInput('coupon-empty'));
  await coupons.update('b2c', adminIdentity, ordinary.id, { targetType: 'category', categoryId: emptyCouponCategory.id });
  await assert.rejects(couponCategories.remove('b2c', newIdentity, emptyCouponCategory.id), { code: 'CATEGORY_HAS_COUPONS' });
  await coupons.remove('b2c', newIdentity, ordinary.id);
  await couponCategories.remove('b2c', newIdentity, emptyCouponCategory.id);
  await products.remove('b2c', newIdentity, couponOther.id);
  const stockProduct = await products.create('b2c', newIdentity, { ...simpleInput(couponChild.id, 'order-stock-simple'), stock: 3 });
  const stockVariants = await products.create('b2c', newIdentity, variantInput(couponChild.id, 'order-stock-variants'));
  const purchased = [{ productId: stockProduct.id, variantId: null, quantity: 2 },
    { productId: stockVariants.id, variantId: stockVariants.variants[0].id, quantity: 2 }];
  const stockRace = await Promise.allSettled([0, 1].map(() => runTransaction(session => products.adjustOrderStock('b2c', purchased, { session }))));
  assert.equal(stockRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(stockRace.find(result => result.status === 'rejected').reason.code, 'ORDER_STOCK_UNAVAILABLE');
  assert.equal((await products.getStaff('b2c', newIdentity, stockProduct.id)).stock, 1);
  assert.equal((await products.getStaff('b2c', newIdentity, stockVariants.id)).variants[0].stock, 3);
  await assert.rejects(runTransaction(async session => {
    await products.adjustOrderStock('b2c', purchased, { session, restore: true });
    throw new Error('order failed');
  }), /order failed/);
  assert.equal((await products.getStaff('b2c', newIdentity, stockProduct.id)).stock, 1);
  await runTransaction(session => products.adjustOrderStock('b2c', purchased, { session, restore: true }));
  const restoredProduct = await products.getStaff('b2c', newIdentity, stockProduct.id);
  assert.equal(restoredProduct.stock, 3); assert.equal(restoredProduct.version, 2);
  assert.equal((await products.getStaff('b2c', newIdentity, stockVariants.id)).variants[0].stock, 5);
  await ordersRepository.initialize();
  let orders;
  products=createProductsService({auth,categories:couponCategories,sales,references:{async hasProductReferences(store,id,variants,session){
    return await cart.hasProductReferences(store,id,variants,session)||await orders.hasProductReferences(store,id,variants,session)
      ||(!variants&&Boolean(await coupons.hasProductReferences(store,id,session)));}}});
  cart=createCartService({auth,products});coupons=createCouponsService({auth,identitySecret:testConfig.couponIdentitySecret,categories:couponCategories,products,cart});
  const proofObjects=new Map(),proofStorage={assertReady(){},scope:()=>({zone:'private',endpoint:'https://storage.bunnycdn.com'}),
    async upload(key,bytes){proofObjects.set(key,Buffer.from(bytes));},async read(key){return proofObjects.get(key);},async remove(key){proofObjects.delete(key);}};
  orders=createOrdersService({auth,cart,products,coupons,shipping,storage:proofStorage,trackingSecret:testConfig.jwtSecret});
  const buyerA={guestToken:'d'.repeat(43)},buyerB={guestToken:'e'.repeat(43)};
  await cart.setItem('b2c',buyerA,{productId:stockProduct.id,quantity:2});
  await cart.setItem('b2c',buyerB,{productId:stockProduct.id,quantity:2});
  const quoteA=await orders.preview('b2c',buyerA,checkoutInput()),quoteB=await orders.preview('b2c',buyerB,checkoutInput());
  const placementRace=await Promise.allSettled([orders.place('b2c',buyerA,{checkoutId:quoteA.checkoutId}),orders.place('b2c',buyerB,{checkoutId:quoteB.checkoutId})]);
  assert.equal(placementRace.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(placementRace.find(row=>row.status==='rejected').reason.code,'ORDER_CART_UNAVAILABLE');
  const winning=placementRace.find(row=>row.status==='fulfilled').value;
  const winningOwner=String((await Order.findById(winning.order.id).lean()).checkoutId)===quoteA.checkoutId ? buyerA : buyerB;
  const winningQuote=winningOwner===buyerA ? quoteA : quoteB;
  assert.equal((await products.getStaff('b2c',newIdentity,stockProduct.id)).stock,1);
  assert.equal((await cart.get('b2c',winningOwner)).items.length,0);
  const replayRace=await Promise.all([orders.place('b2c',winningOwner,{checkoutId:winningQuote.checkoutId}),orders.place('b2c',winningOwner,{checkoutId:winningQuote.checkoutId})]);
  assert.ok(replayRace.every(row=>!row.created&&row.order.id===winning.order.id&&row.trackingToken===winning.trackingToken));
  assert.equal(await Order.countDocuments({checkoutId:winningQuote.checkoutId}),1);
  assert.equal((await orders.track('b2c',winning.order.id,winning.trackingToken,'ar')).items[0].name,'قميص');
  const cancelRace=await Promise.all([0,1].map(()=>orders.changeStatus('b2c',adminIdentity,winning.order.id,{status:'canceled',expectedStatus:'pending'})));
  assert.ok(cancelRace.every(row=>row.stockRestored));assert.equal((await products.getStaff('b2c',newIdentity,stockProduct.id)).stock,3);
  assert.equal((await Order.findById(winning.order.id).lean()).history.length,2);
  await cart.clear('b2c',buyerA);await cart.clear('b2c',buyerB);
  await assert.rejects(products.remove('b2c',newIdentity,stockProduct.id),{code:'PRODUCT_REFERENCED'});
  const orderCoupon=await coupons.create('b2c',adminIdentity,couponInput({code:'ORDERLIMIT',maxUses:1,maxUsesPerPerson:1}));
  await cart.setItem('b2c',buyerA,{productId:stockVariants.id,variantId:stockVariants.variants[0].id,quantity:1});
  const couponQuote=await orders.preview('b2c',buyerA,checkoutInput({couponCode:orderCoupon.code}));
  const failingOrders=createOrdersService({auth,cart,products,coupons,shipping,storage:proofStorage,trackingSecret:testConfig.jwtSecret,
    repository:{...ordersRepository,async create(){throw new Error('order write failed');}}});
  await assert.rejects(failingOrders.place('b2c',buyerA,{checkoutId:couponQuote.checkoutId}),/order write failed/);
  assert.equal((await Coupon.findById(orderCoupon.id).lean()).usedCount,0);assert.equal(await CouponRedemption.countDocuments({couponId:orderCoupon.id}),0);
  assert.equal((await products.getStaff('b2c',newIdentity,stockVariants.id)).variants[0].stock,5);
  assert.equal((await cart.get('b2c',buyerA)).itemCount,1);
  const withCoupon=await orders.place('b2c',buyerA,{checkoutId:couponQuote.checkoutId});
  await orders.changeStatus('b2c',adminIdentity,withCoupon.order.id,{status:'accepted',expectedStatus:'pending'});
  const shipCancel=await Promise.allSettled([
    orders.changeStatus('b2c',adminIdentity,withCoupon.order.id,{status:'shipped',expectedStatus:'accepted'}),
    orders.changeStatus('b2c',newIdentity,withCoupon.order.id,{status:'canceled',expectedStatus:'accepted'}),
  ]);
  assert.equal(shipCancel.filter(row=>row.status==='fulfilled').length,1);assert.equal(shipCancel.find(row=>row.status==='rejected').reason.code,'ORDER_STATUS_CONFLICT');
  const resulting=shipCancel.find(row=>row.status==='fulfilled').value;
  if(resulting.status==='shipped'){
    await assert.rejects(orders.changeStatus('b2c',adminIdentity,resulting.id,{status:'canceled',expectedStatus:'shipped'}),{code:'ORDER_STATUS_INVALID'});
    const delivered=await orders.changeStatus('b2c',adminIdentity,resulting.id,{status:'delivered',expectedStatus:'shipped'});assert.ok(delivered.payment.cashCollectedAt);
    await orders.changeStatus('b2c',adminIdentity,resulting.id,{status:'returned',expectedStatus:'delivered'});
  }
  assert.equal((await Coupon.findById(orderCoupon.id).lean()).usedCount,1);assert.equal(await CouponRedemption.countDocuments({couponId:orderCoupon.id}),1);
  assert.equal((await products.getStaff('b2c',newIdentity,stockVariants.id)).variants[0].stock,5);
  const settingsAudits=await OrderAudit.countDocuments();
  await orders.setSettings('b2c',adminIdentity,{receivingAccount:'old@instapay'});
  assert.equal(await OrderAudit.countDocuments(),settingsAudits+1);
  await cart.setItem('b2c',buyerA,{productId:stockProduct.id,quantity:1});
  const ipQuote=await orders.preview('b2c',buyerA,checkoutInput({paymentMethod:'instapay'}));
  await orders.setSettings('b2c',adminIdentity,{receivingAccount:'new@instapay'});
  const proof=await orders.uploadProof('b2c',buyerA,ipQuote.checkoutId,png,'image/png');
  await assert.rejects(failingOrders.place('b2c',buyerA,{checkoutId:ipQuote.checkoutId,proofId:proof.id}),/order write failed/);
  assert.equal((await OrderProof.findById(proof.id).lean()).status,'ready');
  const ipOrder=await orders.place('b2c',buyerA,{checkoutId:ipQuote.checkoutId,proofId:proof.id});
  assert.equal(ipOrder.order.payment.receivingAccount,'old@instapay');assert.equal((await OrderProof.findById(proof.id).lean()).status,'attached');
  const acceptedIp=await orders.changeStatus('b2c',adminIdentity,ipOrder.order.id,{status:'accepted',expectedStatus:'pending'});assert.ok(acceptedIp.payment.verifiedAt);
  assert.equal((await sharp(await orders.readStaffProof('b2c',newIdentity,ipOrder.order.id)).metadata()).format,'webp');
  const lateCleanup=createOrdersService({storage:proofStorage,now:()=>new Date(Date.now()+2*24*60*60*1000)});
  assert.deepEqual(await lateCleanup.cleanupProofs(),{removed:0,failed:0});assert.equal(proofObjects.size,1);
  await wishlistRepository.initialize();
  let wishlist;
  const wishlistProducts = createProductsService({ auth, categories: couponCategories, sales,
    references: { hasProductReferences: (store, id, variants, session) => variants ? false : wishlist.hasProductReferences(store, id, session) } });
  wishlist = createWishlistService({ auth, products: wishlistProducts });
  const wishlistSimple = await wishlistProducts.create('b2c', newIdentity, simpleInput(couponChild.id, 'wishlist-simple'));
  const wishlistVariant = await wishlistProducts.create('b2c', newIdentity, variantInput(couponChild.id, 'wishlist-variant'));
  assert.deepEqual(await wishlist.get('b2c', customer.identity), { items: [], itemCount: 0 });
  assert.equal(await Wishlist.countDocuments({}), 0);
  const wishlistAdds = await Promise.all([
    wishlist.add('b2c', customer.identity, wishlistSimple.id),
    wishlist.add('b2c', customer.identity, wishlistSimple.id),
    wishlist.add('b2c', customer.identity, wishlistVariant.id),
  ]);
  assert.ok(wishlistAdds.every(result => result.itemCount >= 1 && result.itemCount <= 2));
  const savedWishlist = await wishlist.get('b2c', customer.identity, 'ar');
  assert.equal(savedWishlist.itemCount, 2);
  assert.ok(savedWishlist.items.every(item => item.product.name === 'قميص'));
  assert.equal(await Wishlist.countDocuments({ store: 'b2c', userId: customer.identity.userId }), 1);
  await assert.rejects(Wishlist.create({ store: 'b2c', userId: customer.identity.userId }), { code: 11000 });
  await assert.rejects(wishlistProducts.remove('b2c', newIdentity, wishlistSimple.id), { code: 'PRODUCT_REFERENCED' });
  await wishlistProducts.update('b2c', newIdentity, wishlistVariant.id, { version: 0, variants: [wishlistVariant.variants[0]] });
  await wishlistProducts.update('b2c', newIdentity, wishlistSimple.id, { version: 0, isActive: false });
  assert.equal((await wishlist.get('b2c', customer.identity)).items.find(item => item.productId === wishlistSimple.id).product, null);
  await assert.rejects(wishlist.add('b2c', customer.identity, wishlistSimple.id), { code: 'PRODUCT_NOT_FOUND' });
  await wishlist.remove('b2c', customer.identity, wishlistSimple.id);
  await wishlistProducts.remove('b2c', newIdentity, wishlistSimple.id);
  const failingWishlist = createWishlistService({ auth, products: wishlistProducts,
    repository: { ...wishlistRepository, async clear(...args) { await wishlistRepository.clear(...args); throw new Error('wishlist deletion failed'); } } });
  await assert.rejects(failingWishlist.clear('b2c', customer.identity), /wishlist deletion failed/);
  assert.equal((await wishlist.get('b2c', customer.identity)).itemCount, 1);
  await wishlist.clear('b2c', customer.identity);
  const wishlistRaceProduct = await wishlistProducts.create('b2c', newIdentity, simpleInput(couponChild.id, 'wishlist-race'));
  const wishlistRace = await Promise.allSettled([
    wishlist.add('b2c', customer.identity, wishlistRaceProduct.id),
    wishlistProducts.remove('b2c', newIdentity, wishlistRaceProduct.id),
  ]);
  assert.equal(wishlistRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['PRODUCT_NOT_FOUND', 'PRODUCT_REFERENCED'].includes(wishlistRace.find(result => result.status === 'rejected').reason.code));
  await wishlist.clear('b2c', customer.identity);
  assert.equal(await Wishlist.countDocuments({}), 0);
  await Promise.all([formsRepository.initialize(), formsRepository.initialize()]);
  assert.equal(await FormDefinition.countDocuments({ store: 'b2b' }), 5);
  assert.equal(await FormDefinition.countDocuments({ isActive: true }), 0);
  const formsEmail = 'forms-staff@example.com';
  await auth.register('b2b', { ...input, email: formsEmail }, 'en');
  await auth.verifyEmail('b2b', formsEmail, messages.at(-1).code);
  await auth.provisionSuperAdmin('b2b', formsEmail);
  const formsStaff = await auth.authenticate('b2b', (await auth.login('b2b', formsEmail, input.password)).accessToken);
  const forms = createFormsService({ auth });
  assert.equal((await forms.browse('b2b')).items.length, 0);
  const formRace = await Promise.allSettled([
    forms.update('b2b', formsStaff, 'spinning', { version: 0, isActive: true, fields: [textField(), choiceField()] }),
    forms.update('b2b', formsStaff, 'spinning', { version: 0, isActive: true, title: { en: 'Updated spinning' } }),
  ]);
  assert.equal(formRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(formRace.find(result => result.status === 'rejected').reason.code, 'FORM_CONFLICT');
  const currentForm = await forms.getStaff('b2b', formsStaff, 'spinning');
  assert.equal(currentForm.version, 1);
  assert.equal(await FormAudit.countDocuments({ formType: 'spinning' }), 1);
  await formsRepository.initialize();
  assert.deepEqual(await forms.getStaff('b2b', formsStaff, 'spinning'), currentForm);
  const failingForms = createFormsService({ auth, repository: { ...formsRepository, async audit() { throw new Error('form audit failed'); } } });
  await assert.rejects(failingForms.update('b2b', formsStaff, 'spinning', { version: 1, isActive: false }), /form audit failed/);
  assert.deepEqual(await forms.getStaff('b2b', formsStaff, 'spinning'), currentForm);
  assert.equal((await forms.getPublic('b2b', 'spinning', 'ar')).fixedFields[2].required, false);
  await forms.update('b2b', formsStaff, 'spinning', { version: 1, isActive: false, fields: [textField()] });
  await assert.rejects(forms.getPublic('b2b', 'spinning'), { code: 'FORM_NOT_FOUND' });
  assert.equal((await forms.getStaff('b2b', formsStaff, 'spinning')).version, 2);
  assert.equal(await FormAudit.countDocuments({ formType: 'spinning' }), 2);
  assert.equal(await FormDefinition.countDocuments({}), 5);
  await wholesaleRepository.initialize();
  let wholesale;
  const wholesaleProducts = createProductsService({ auth, categories: couponCategories,
    references: { hasProductReferences: (store, productId, variantIds, session) => wholesale.hasB2cReferences(productId, variantIds, session) } });
  const wholesaleMedia = createMediaService({ auth, storage: fakeStorage.storage, logger: { error() {} },
    targets: { product: { getStaff: (...args) => wholesale.getProduct(...args) } } });
  wholesale = createWholesaleService({ auth, products: wholesaleProducts, media: wholesaleMedia });
  const wholesaleSimple = await wholesaleProducts.create('b2c', newIdentity, { ...simpleInput(couponChild.id, 'wholesale-zero-stock'), stock: 0 });
  const wholesaleVariant = await wholesaleProducts.create('b2c', newIdentity, variantInput(couponChild.id, 'wholesale-variants'));
  assert.equal((await wholesale.selectB2c('b2b', formsStaff, { q: '.*' })).pagination.total, 0);
  assert.ok((await wholesale.selectB2c('b2b', formsStaff, { q: 'wholesale-zero-stock' })).items.some(row => row.id === wholesaleSimple.id));
  const native = await wholesale.createProduct('b2b', formsStaff, nativeInput);
  assert.equal(await WholesaleProduct.countDocuments({ store: 'b2b' }), 1);
  assert.equal(await productsRepository.findById('b2c', native.id), null);
  const nativeOffer = await wholesale.createOffer('b2b', formsStaff, { ...offerInput('b2b', native.id), isActive: true });
  assert.equal((await wholesale.getPublic('b2b', nativeOffer.id)).piecesPerPouch, 30);
  const lowStockOffer = await wholesale.createOffer('b2b', formsStaff, { ...offerInput('b2c', wholesaleSimple.id), isActive: true });
  assert.equal(lowStockOffer.isAvailable, true);
  const mixedOffer = await wholesale.createOffer('b2b', formsStaff,
    offerInput('b2c', wholesaleVariant.id, wholesaleVariant.variants.map((row, index) => ({ variantId: row.id, quantity: index ? 20 : 10 }))));
  await assert.rejects(wholesaleProducts.remove('b2c', newIdentity, wholesaleVariant.id), { code: 'PRODUCT_REFERENCED' });
  await assert.rejects(wholesaleProducts.update('b2c', newIdentity, wholesaleVariant.id, { version: 0, variants: [wholesaleVariant.variants[0]] }), { code: 'PRODUCT_REFERENCED' });
  const offerRace = await Promise.allSettled([
    wholesale.updateOffer('b2b', formsStaff, nativeOffer.id, { version: 0, name: { en: 'Changed pouch' } }),
    wholesale.updateOffer('b2b', formsStaff, nativeOffer.id, { version: 0, composition: [{ quantity: 60 }] }),
  ]);
  assert.equal(offerRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(offerRace.find(result => result.status === 'rejected').reason.code, 'WHOLESALE_CONFLICT');
  const nativeImageBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  const nativeImage = await wholesaleMedia.upload('b2b', formsStaff, 'product', native.id, nativeImageBuffer, 'image/png');
  assert.match((await Media.findById(nativeImage.id).lean()).objectKey, /^narmer\/b2b\/catalog\/product\//);
  const failingWholesale = createWholesaleService({ auth, products: wholesaleProducts, media: wholesaleMedia,
    repository: { ...wholesaleRepository, async audit() { throw new Error('wholesale audit failed'); } } });
  await assert.rejects(failingWholesale.updateProduct('b2b', formsStaff, native.id, { version: 0, imageIds: [nativeImage.id] }), /wholesale audit failed/);
  assert.equal((await Media.findById(nativeImage.id).lean()).status, 'ready');
  assert.equal((await wholesale.getProduct('b2b', formsStaff, native.id)).version, 0);
  await wholesale.updateProduct('b2b', formsStaff, native.id, { version: 0, imageIds: [nativeImage.id] });
  assert.equal((await wholesale.getPublic('b2b', nativeOffer.id)).product.images.length, 1);
  await assert.rejects(wholesale.removeProduct('b2b', formsStaff, native.id), { code: 'WHOLESALE_REFERENCED' });
  await wholesaleProducts.update('b2c', newIdentity, wholesaleSimple.id, { version: 0, isActive: false });
  await assert.rejects(wholesale.getPublic('b2b', lowStockOffer.id), { code: 'WHOLESALE_OFFER_NOT_FOUND' });
  assert.equal((await wholesale.getOffer('b2b', formsStaff, lowStockOffer.id)).product, null);
  await wholesale.updateOffer('b2b', formsStaff, lowStockOffer.id, { version: 0, isActive: false });
  await wholesale.removeOffer('b2b', formsStaff, nativeOffer.id);
  await wholesale.removeProduct('b2b', formsStaff, native.id);
  assert.equal(await Media.findById(nativeImage.id).lean(), null);
  const nativeRaceProduct = await wholesale.createProduct('b2b', formsStaff, nativeInput);
  const nativeRace = await Promise.allSettled([
    wholesale.createOffer('b2b', formsStaff, offerInput('b2b', nativeRaceProduct.id)),
    wholesale.removeProduct('b2b', formsStaff, nativeRaceProduct.id),
  ]);
  assert.equal(nativeRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['WHOLESALE_REFERENCED', 'WHOLESALE_SOURCE_UNAVAILABLE'].includes(nativeRace.find(result => result.status === 'rejected').reason.code));
  const b2cRaceProduct = await wholesaleProducts.create('b2c', newIdentity, simpleInput(couponChild.id, 'wholesale-race'));
  const b2cRace = await Promise.allSettled([
    wholesale.createOffer('b2b', formsStaff, offerInput('b2c', b2cRaceProduct.id)),
    wholesaleProducts.remove('b2c', newIdentity, b2cRaceProduct.id),
  ]);
  assert.equal(b2cRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['PRODUCT_REFERENCED', 'WHOLESALE_SOURCE_UNAVAILABLE'].includes(b2cRace.find(result => result.status === 'rejected').reason.code));
  assert.ok(await WholesaleAudit.countDocuments({ store: 'b2b' }) >= 10);
  for (const row of await WholesaleOffer.find({ sourceStore: 'b2b' }).lean()) assert.ok(await WholesaleProduct.exists({ _id: row.productId }));
  await wholesale.removeOffer('b2b', formsStaff, mixedOffer.id);
  await wholesaleProducts.update('b2c', newIdentity, wholesaleVariant.id, { version: 0, variants: [wholesaleVariant.variants[0]] });
  await leadsRepository.initialize();
  let leads;
  wholesale = createWholesaleService({ auth, products: wholesaleProducts, media: wholesaleMedia,
    references: { hasOfferReferences: (...args) => leads.hasOfferReferences(...args) } });
  const leadObjects = new Map(), leadStorage = { assertReady() {}, scope: () => ({ endpoint: 'https://storage.bunnycdn.com', zone: 'private-test' }),
    async upload(key, bytes) { leadObjects.set(key, Buffer.from(bytes)); },
    async read(key) { return Buffer.from(leadObjects.get(key)); }, async remove(key) { leadObjects.delete(key); } };
  const leadOptions = { auth, forms, wholesale, storage: leadStorage, trackingSecret: testConfig.jwtSecret };
  leads = createLeadsService(leadOptions);
  await forms.update('b2b', formsStaff, 'fabric', { version: 0, isActive: true, fields: [
    { ...textField('quantity'), type: 'number', required: true },
    { ...textField('owns-material'), type: 'boolean', required: true },
  ] });
  const leadDraft = await leads.prepare('b2b', null, 'fabric');
  const leadImage = await leads.upload('b2b', null, leadDraft.draftId, leadDraft.draftToken, png, 'image/png');
  const leadInput = { draftId: leadDraft.draftId, formVersion: 1, contact: leadContact,
    answers: { quantity: 0, 'owns-material': false }, imageIds: [leadImage.id] };
  const failingLeads = createLeadsService({ ...leadOptions,
    repository: { ...leadsRepository, async create() { throw new Error('lead write failed'); } } });
  await assert.rejects(failingLeads.submit('b2b', null, leadDraft.draftToken, leadInput), /lead write failed/);
  assert.equal((await LeadDraft.findById(leadDraft.draftId).lean()).status, 'open');
  assert.equal((await LeadImage.findById(leadImage.id).lean()).status, 'ready');
  const leadRace = await Promise.all([
    leads.submit('b2b', null, leadDraft.draftToken, leadInput), leads.submit('b2b', null, leadDraft.draftToken, leadInput),
  ]);
  assert.equal(leadRace.filter(row => row.created).length, 1);
  assert.equal(await Lead.countDocuments({ draftId: leadDraft.draftId }), 1);
  assert.equal(leadRace[0].lead.id, leadRace[1].lead.id); assert.equal(leadRace[0].trackingToken, leadRace[1].trackingToken);
  const savedLead = leadRace[0];
  assert.equal((await LeadImage.findById(leadImage.id).lean()).status, 'attached');
  assert.equal((await sharp(await leads.readImage('b2b', formsStaff, savedLead.lead.id, leadImage.id)).metadata()).format, 'webp');
  await forms.update('b2b', formsStaff, 'fabric', { version: 1, fields: [], isActive: false });
  assert.equal((await leads.track('b2b', savedLead.lead.id, savedLead.trackingToken)).form.fields.length, 2);
  assert.equal((await leads.submit('b2b', null, leadDraft.draftToken, leadInput)).created, false);
  await assert.rejects(leads.submit('b2b', null, leadDraft.draftToken, { ...leadInput, imageIds: [] }), { code: 'LEAD_REQUEST_CONFLICT' });
  const failContact = createLeadsService({ ...leadOptions,
    repository: { ...leadsRepository, async audit() { throw new Error('lead audit failed'); } } });
  await assert.rejects(failContact.contacted('b2b', formsStaff, savedLead.lead.id), /lead audit failed/);
  assert.equal((await Lead.findById(savedLead.lead.id).lean()).status, 'submitted');
  const contacts = await Promise.all([leads.contacted('b2b', formsStaff, savedLead.lead.id), leads.contacted('b2b', formsStaff, savedLead.lead.id)]);
  assert.deepEqual(contacts[0], contacts[1]); assert.equal(await LeadAudit.countDocuments({ leadId: savedLead.lead.id }), 1);
  await forms.update('b2b', formsStaff, 'wholesale', { version: 0, isActive: true });
  const leadNative = await wholesale.createProduct('b2b', formsStaff, nativeInput);
  const leadOffer = await wholesale.createOffer('b2b', formsStaff, { ...offerInput('b2b', leadNative.id), isActive: true });
  const offerDraft = await leads.prepare('b2b', null, 'wholesale');
  const offerLead = await leads.submit('b2b', null, offerDraft.draftToken, { draftId: offerDraft.draftId, formVersion: 1,
    contact: leadContact, wholesaleRequests: [{ offerId: leadOffer.id, version: 0, quantity: 2 }] });
  await assert.rejects(wholesale.removeOffer('b2b', formsStaff, leadOffer.id), { code: 'WHOLESALE_REFERENCED' });
  await wholesale.updateOffer('b2b', formsStaff, leadOffer.id, { version: 0, composition: [{ quantity: 60 }] });
  assert.equal((await leads.track('b2b', offerLead.lead.id, offerLead.trackingToken)).wholesaleRequests[0].piecesPerPouch, 30);
  const staleOfferDraft = await leads.prepare('b2b', null, 'wholesale');
  await assert.rejects(leads.submit('b2b', null, staleOfferDraft.draftToken, { draftId: staleOfferDraft.draftId, formVersion: 1,
    contact: leadContact, wholesaleRequests: [{ offerId: leadOffer.id, version: 0, quantity: 1 }] }), { code: 'WHOLESALE_CONFLICT' });
  const uploadsDraft = await leads.prepare('b2b', null, 'wholesale');
  const leadUploads = await Promise.allSettled(Array.from({ length: 6 }, () => leads.upload('b2b', null, uploadsDraft.draftId, uploadsDraft.draftToken, png, 'image/png')));
  assert.equal(leadUploads.filter(row => row.status === 'fulfilled').length, 5);
  assert.equal(leadUploads.find(row => row.status === 'rejected').reason.code, 'LEAD_IMAGE_LIMIT');
  const lateLeads = createLeadsService({ ...leadOptions, now: () => new Date(Date.now() + 2 * 86400000) });
  assert.deepEqual(await lateLeads.cleanupImages(), { removed: 5, failed: 0 });
  assert.equal(await LeadImage.countDocuments({ status: 'attached' }), 1); assert.equal(leadObjects.size, 1);
  const expiredLeads = createLeadsService({ ...leadOptions, now: () => new Date(Date.now() + 91 * 86400000) });
  await assert.rejects(expiredLeads.track('b2b', savedLead.lead.id, savedLead.trackingToken), { code: 'LEAD_NOT_FOUND' });
  await assert.rejects(expiredLeads.submit('b2b', null, leadDraft.draftToken, leadInput), { code: 'LEAD_NOT_FOUND' });
  await staff.remove('b2c', newIdentity, user._id);
  assert.equal((await users.findAccountByEmail('b2c', input.email)).status, 'deleted');
  await assert.rejects(users.registerAccount('b2c', input, 'hash'), { code: 11000 });
});
