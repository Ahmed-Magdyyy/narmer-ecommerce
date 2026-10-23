import { AppError } from '../../shared/errors/app-error.js';
import { createHash, createHmac } from 'node:crypto';
import { runTransaction } from '../../shared/utils/transaction.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';
import { couponsRepository } from './coupons.repository.js';

export function calculateCouponDiscount(cart, { discountType, discountValue }, inScope = cart.items.map(() => true)) {
  if (!['percentage', 'fixed'].includes(discountType) || !Number.isSafeInteger(discountValue)
    || discountValue < 1 || discountValue > (discountType === 'percentage' ? 100 : 1000000000)) {
    throw new AppError(422, 'INVALID_COUPON');
  }
  if (!cart.canCheckout || !cart.items.length) throw new AppError(409, 'CART_COUPON_UNAVAILABLE');
  const eligible = cart.items.map((item, index) => item.activeSale == null && inScope[index]);
  if (!eligible.some(Boolean)) throw new AppError(409, 'COUPON_NO_ELIGIBLE_ITEMS');
  const eligibleSubtotal = cart.items.reduce((sum, item, index) => sum + (eligible[index] ? item.lineTotal : 0), 0);
  const discountAmount = discountType === 'fixed' ? Math.min(discountValue, eligibleSubtotal)
    : Number(BigInt(eligibleSubtotal) * BigInt(discountValue) / 100n);
  const shares = cart.items.map((item, index) => {
    const numerator = eligible[index] ? BigInt(item.lineTotal) * BigInt(discountAmount) : 0n;
    return { index, amount: eligibleSubtotal ? Number(numerator / BigInt(eligibleSubtotal)) : 0,
      remainder: eligibleSubtotal ? numerator % BigInt(eligibleSubtotal) : 0n };
  });
  // Largest remainders distribute leftover piastres without losing money through floating-point rounding.
  const ranked = shares.filter(share => eligible[share.index]).sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  const remaining = discountAmount - shares.reduce((sum, share) => sum + share.amount, 0);
  for (let index = 0; index < remaining; index++) ranked[index].amount++;
  return { eligibleSubtotal, discountAmount, subtotalAfterDiscount: cart.subtotal - discountAmount,
    allocations: cart.items.map((item, index) => ({ productId: item.productId, variantId: item.variantId,
      eligible: eligible[index], discountAmount: shares[index].amount,
      lineTotalAfterDiscount: item.lineTotal - shares[index].amount })) };
}

const invalid = () => { throw new AppError(422, 'INVALID_COUPON'); };
const checkStore = store => { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); };
const objectId = value => {
  const result = String(value).toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(result)) invalid();
  return result;
};
const codeFrom = value => {
  if (typeof value !== 'string') invalid();
  const result = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(result)) invalid();
  return result;
};
function customerKeys(phone, secret) {
  if (typeof phone !== 'string') invalid();
  const normalized = normalizePhone(phone.trim());
  if (!validPhone(normalized)) invalid();
  let digits = normalized.replace(/^\+/, '').replace(/^00/, '');
  if (/^01\d{9}$/.test(digits)) digits = `20${digits.slice(1)}`;
  return [createHmac('sha256', secret).update(`coupon-person:b2c:${digits}`).digest('hex'),
    createHash('sha256').update(`b2c:${digits}`).digest('hex')];
}
const dateFrom = value => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) invalid();
  return result;
};
const fieldsAllowed = ['code', 'name', 'targetType', 'productIds', 'categoryId', 'discountType', 'discountValue',
  'minimumSpend', 'maxUses', 'maxUsesPerPerson', 'startsAt', 'endsAt', 'isEnabled'];
function build(input, previous) {
  const supplied = key => Object.hasOwn(input, key);
  const targetType = input.targetType ?? previous?.targetType;
  const changedTarget = previous && targetType !== previous.targetType;
  const products = supplied('productIds') ? input.productIds : (changedTarget ? [] : previous?.productIds ?? []);
  const category = supplied('categoryId') ? input.categoryId : (changedTarget ? null : previous?.categoryId ?? null);
  const name = Object.fromEntries(['ar', 'en'].map(locale => {
    const value = Object.hasOwn(input.name ?? {}, locale) ? input.name[locale] : previous?.name[locale];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 150) invalid();
    return [locale, value.trim()];
  }));
  const fields = { code: codeFrom(input.code ?? previous?.code), name, targetType,
    productIds: [], categoryId: null, discountType: input.discountType ?? previous?.discountType,
    discountValue: supplied('discountValue') ? input.discountValue : previous?.discountValue,
    minimumSpend: supplied('minimumSpend') ? input.minimumSpend : previous?.minimumSpend ?? 0,
    isEnabled: supplied('isEnabled') ? input.isEnabled : previous?.isEnabled ?? true };
  if (!['all', 'products', 'category'].includes(targetType) || !Array.isArray(products) || products.length > 100
    || typeof fields.isEnabled !== 'boolean' || !['percentage', 'fixed'].includes(fields.discountType)
    || !Number.isSafeInteger(fields.discountValue) || fields.discountValue < 1
    || fields.discountValue > (fields.discountType === 'percentage' ? 100 : 1000000000)
    || !Number.isSafeInteger(fields.minimumSpend) || fields.minimumSpend < 0 || fields.minimumSpend > 1000000000000000) invalid();
  for (const key of ['maxUses', 'maxUsesPerPerson']) {
    fields[key] = supplied(key) ? input[key] : previous?.[key] ?? null;
    if (fields[key] !== null && (!Number.isSafeInteger(fields[key]) || fields[key] < 1 || fields[key] > 1000000000)) invalid();
  }
  for (const key of ['startsAt', 'endsAt']) fields[key] = supplied(key) ? dateFrom(input[key]) : previous?.[key] ?? null;
  if (fields.startsAt && fields.endsAt && fields.endsAt <= fields.startsAt) invalid();
  if (targetType === 'products') {
    if (!products.length || category !== null) invalid();
    fields.productIds = products.map(objectId);
    if (new Set(fields.productIds).size !== fields.productIds.length) invalid();
  } else if (targetType === 'category') {
    if (products.length || category === null) invalid();
    fields.categoryId = objectId(category);
  } else if (products.length || category !== null) invalid();
  return fields;
}
const status = (row, at) => !row.isEnabled ? 'disabled' : row.startsAt && at < row.startsAt ? 'scheduled'
  : row.endsAt && at >= row.endsAt ? 'expired' : row.maxUses !== null && row.usedCount >= row.maxUses ? 'exhausted' : 'active';
const view = (row, at) => ({ id: String(row._id), code: row.code, name: row.name, targetType: row.targetType,
  productIds: row.productIds.map(String), categoryId: row.categoryId == null ? null : String(row.categoryId),
  discountType: row.discountType, discountValue: row.discountValue, minimumSpend: row.minimumSpend,
  maxUses: row.maxUses, maxUsesPerPerson: row.maxUsesPerPerson, usedCount: row.usedCount,
  startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null,
  isEnabled: row.isEnabled, status: status(row, at), currency: 'EGP' });

export function createCouponsService({ auth, categories, products, cart, identitySecret, repository = couponsRepository, transaction = runTransaction, now = () => new Date() }) {
  if (typeof identitySecret !== 'string' || Buffer.byteLength(identitySecret) < 32) throw new Error('Coupon identity secret is required.');
  async function mutate(store, identity, action, couponId, input) {
    checkStore(store);
    try {
      return await transaction(async session => {
        const actor = await auth.authorizeStaff(store, identity, action === 'deleted' ? ['superAdmin'] : ['superAdmin', 'admin'], session);
        await categories.lockForCatalog(store, session);
        const previous = action === 'created' ? null : await repository.findById(store, couponId, session);
        if (action !== 'created' && !previous) throw new AppError(404, 'COUPON_NOT_FOUND');
        let changed;
        if (action === 'deleted') {
          if (await repository.hasRedemptions(store, couponId, session)) throw new AppError(409, 'COUPON_REFERENCED');
          await repository.remove(store, couponId, session);
        } else {
          if (previous && !Object.keys(input).some(key => fieldsAllowed.includes(key))) invalid();
          const fields = build(input, previous);
          if (fields.targetType === 'products') {
            if ((await products.getCatalogReferences(store, fields.productIds, { session })).length !== fields.productIds.length) throw new AppError(409, 'COUPON_TARGET_NOT_FOUND');
          } else if (fields.targetType === 'category') {
            if (!(await categories.getCatalogCategories(store, session)).some(row => row.id === fields.categoryId)) throw new AppError(409, 'COUPON_TARGET_NOT_FOUND');
          }
          changed = previous ? await repository.update(store, couponId, fields, session) : await repository.create({ store, ...fields, usedCount: 0 }, session);
          if (!changed) throw new AppError(409, 'COUPON_CONFLICT');
        }
        await repository.audit({ store, actorId: actor._id, couponId: changed?._id ?? previous._id,
          action, fields: Object.keys(input).filter(key => fieldsAllowed.includes(key)) }, session);
        return changed ? view(changed, now()) : null;
      });
    } catch (error) {
      if (error.code === 11000) throw new AppError(409, 'COUPON_CODE_EXISTS');
      throw error;
    }
  }
  async function quote(store, owner, code, phone, { session, locale = 'en', at }) {
    checkStore(store);
    const keys = customerKeys(phone, identitySecret), key = keys[0];
    const current = await cart.getForCoupon(store, owner, { session, locale, at });
    const coupon = await repository.findByCode(store, codeFrom(code), session);
    if (!coupon || status(coupon, at) !== 'active') throw new AppError(409, 'COUPON_UNAVAILABLE');
    if (coupon.maxUsesPerPerson !== null && await repository.countPersonUses(store, coupon._id, keys, session) >= coupon.maxUsesPerPerson) throw new AppError(409, 'COUPON_PERSON_LIMIT_REACHED');
    let inScope = current.items.map(() => true);
    if (coupon.targetType === 'products') {
      const selected = new Set(coupon.productIds.map(String));
      inScope = current.items.map(item => selected.has(item.productId));
    } else if (coupon.targetType === 'category') {
      const catalog = await categories.getCatalogCategories(store, session);
      const scope = new Set([String(coupon.categoryId)]);
      for (let level = 0; level < 2; level++) for (const category of catalog) if (scope.has(category.parentId)) scope.add(category.id);
      const selected = new Set((await products.getCatalogReferences(store, current.items.map(item => item.productId), { session }))
        .filter(product => scope.has(product.categoryId)).map(product => product.id));
      inScope = current.items.map(item => selected.has(item.productId));
    }
    const calculation = calculateCouponDiscount(current, coupon, inScope);
    if (calculation.eligibleSubtotal < coupon.minimumSpend) throw new AppError(409, 'COUPON_MINIMUM_SPEND');
    return { coupon, key, preview: { coupon: { id: String(coupon._id), code: coupon.code, name: locale ? coupon.name[locale] : coupon.name,
      discountType: coupon.discountType, discountValue: coupon.discountValue }, currency: 'EGP', subtotal: current.subtotal, ...calculation } };
  }
  return {
    async list(store, identity, input = {}) {
      checkStore(store);
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const page = input.page ?? 1, limit = input.limit ?? 20;
      const [rows, total] = await repository.list(store, { ...input, page, limit });
      const at = now();
      return { items: rows.map(row => view(row, at)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },
    async getStaff(store, identity, couponId) {
      checkStore(store);
      await auth.authorizeStaff(store, identity, ['superAdmin', 'admin']);
      const row = await repository.findById(store, couponId);
      if (!row) throw new AppError(404, 'COUPON_NOT_FOUND');
      return view(row, now());
    },
    create: (store, identity, input) => mutate(store, identity, 'created', null, input),
    update: (store, identity, couponId, input) => mutate(store, identity, 'updated', couponId, input),
    remove: (store, identity, couponId) => mutate(store, identity, 'deleted', couponId, {}),
    async preview(store, owner, code, phone, locale) {
      checkStore(store);
      const at = now();
      return transaction(async session => (await quote(store, owner, code, phone, { session, locale, at })).preview);
    },
    async previewForOrder(store, owner, code, phone, options) {
      if (!options.session) throw new Error('Checkout coupon calculation requires its transaction session.');
      return (await quote(store, owner, code, phone, options)).preview;
    },
    async redeem(store, owner, code, phone, { session, orderId, locale = 'en', at = now() }) {
      checkStore(store);
      if (!session) throw new Error('Coupon redemption requires the order transaction session.');
      const order = objectId(orderId);
      await categories.lockForCatalog(store, session);
      if (await repository.findOrderRedemption(store, order, session)) throw new AppError(409, 'COUPON_ALREADY_REDEEMED');
      const { coupon, key, preview } = await quote(store, owner, code, phone, { session, locale, at });
      if (!await repository.incrementUsage(store, coupon._id, coupon.usedCount, session)) throw new AppError(409, 'COUPON_CONFLICT');
      await repository.recordRedemption({ store, couponId: coupon._id, orderId: order, customerKey: key, discountAmount: preview.discountAmount }, session);
      return preview;
    },
    hasProductReferences: (store, productId, session) => repository.hasProductReferences(store, productId, session),
    hasCategoryReferences: (store, categoryId, session) => repository.hasCategoryReferences(store, categoryId, session),
  };
}
