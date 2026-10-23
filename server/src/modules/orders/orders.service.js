import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { runTransaction } from '../../shared/utils/transaction.js';
import { processCatalogImage } from '../../shared/infrastructure/media/image.js';
import { normalizePhone, validPhone } from '../../shared/utils/phone.js';
import { logger as defaultLogger } from '../../shared/utils/logger.js';
import { ordersRepository } from './orders.repository.js';
import { orderStatuses } from './orders.model.js';

const id = value => String(value).toLowerCase();
const newId = () => randomBytes(12).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const checkStore = store => { if (store !== 'b2c') throw new AppError(400, 'INVALID_STORE'); };
const invalid = () => { throw new AppError(422, 'INVALID_ORDER'); };
const ids = value => { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid(); return value.toLowerCase(); };
const selections = cart => JSON.stringify(cart.items.map(item => [item.productId, item.variantId, item.quantity]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const staffRoles = ['superAdmin', 'admin', 'moderator'];
const transitions = { pending: ['accepted', 'canceled'], accepted: ['shipped', 'canceled'], shipped: ['delivered'], delivered: ['returned'], canceled: [], returned: [] };
const iso = value => value ? new Date(value).toISOString() : null;
const local = (value, locale) => value && typeof value === 'object' ? value[locale] : value;
function inputFrom(input) {
  const text = (value, max, required = true) => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid(); return value.trim();
  };
  const phone = normalizePhone(text(input.customer?.phone, 100)); if (!validPhone(phone)) invalid();
  const email = text(input.customer?.email, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid();
  const address = Object.fromEntries([['governorate',100],['district',100],['building',200],['street',200]].map(([key,max]) => [key,text(input.address?.[key],max)]));
  address.governorateCode = text(input.address?.governorateCode,100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(address.governorateCode)) invalid();
  for (const [key,max] of [['floor',50],['apartment',50],['details',1000]]) address[key] = text(input.address?.[key] ?? '',max,false);
  if (!['cod','instapay'].includes(input.paymentMethod)) invalid();
  const couponCode = input.couponCode === undefined ? null : text(input.couponCode,40).toUpperCase();
  if (couponCode !== null && !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(couponCode)) invalid();
  return { customer: { name: text(input.customer?.name,100), email, phone }, address, paymentMethod: input.paymentMethod, couponCode };
}
function presentPreview(preview, locale) {
  return { ...preview, items: preview.items.map(item => ({ ...item, productId:id(item.productId),variantId:item.variantId ? id(item.variantId) : null,name: local(item.name,locale),
    category:item.category ? { id:id(item.category.id), name:local(item.category.name,locale) } : null,
    activeSale: item.activeSale ? { ...item.activeSale,name:local(item.activeSale.name,locale) } : null })),
    coupon: preview.coupon ? { ...preview.coupon,name:local(preview.coupon.name,locale) } : null,
    shipping: { ...preview.shipping,name:local(preview.shipping.name,locale) } };
}
export function orderView(row, locale, staff = false) {
  const priced = presentPreview({ items: row.items, coupon: row.coupon, shipping: row.shipping },locale);
  const payment = { method: row.payment.method, receivingAccount: row.payment.receivingAccount,
    hasProof: row.payment.proofId !== null, verifiedAt: iso(row.payment.verifiedAt), cashCollectedAt: iso(row.payment.cashCollectedAt),
    ...(staff ? { proofId: row.payment.proofId ? id(row.payment.proofId) : null,
      verifiedBy: row.payment.verifiedBy ? id(row.payment.verifiedBy) : null, cashCollectedBy: row.payment.cashCollectedBy ? id(row.payment.cashCollectedBy) : null } : {}) };
  return { id: id(row._id), status: row.status, customer: row.customer, address: row.address, items: priced.items,
    coupon: priced.coupon, shipping: priced.shipping, totals: row.totals,currency:'EGP',payment,
    refund: row.refund ? { amount:row.refund.amount,at:iso(row.refund.at),...(staff ? { actorId:id(row.refund.actorId) } : {}) } : null,
    history: row.history.map(event => ({ status:event.status,at:iso(event.at),...(staff ? { actorId:event.actorId ? id(event.actorId) : null } : {}) })),
    createdAt:iso(row.createdAt),updatedAt:iso(row.updatedAt),
    ...(staff ? { userId:row.userId ? id(row.userId) : null,stockRestored:row.stockRestored,
      quotedPreview:presentPreview(row.quotedPreview,locale) } : {}) };
}

export function createOrdersService({ auth, cart, products, coupons, shipping, storage, trackingSecret,
  repository = ordersRepository, transaction = runTransaction, now = () => new Date(), logger = defaultLogger, notifications = null }) {
  const tokenFor = row => createHmac('sha256',trackingSecret).update(`narmer-order:${id(row._id)}:${row.ownerKey}:${id(row.checkoutId)}`).digest('base64url');
  const placementView = (row,locale,created) => {
    const candidate=row.userId ? null : tokenFor(row);
    // After signing-key rotation, preserve old tracking links instead of returning an invalid replacement.
    return { created,order:orderView(row,locale),trackingToken:candidate && hash(candidate)===row.trackingHash ? candidate : null,
      trackingExpiresAt:row.userId ? null : iso(row.trackingExpiresAt) };
  };
  async function scopedCheckout(store,owner,checkoutId,session,at) {
    const owned = await cart.checkoutOwner(store,owner,session);
    const checkout = await repository.findCheckout(store,ids(checkoutId),owned.ownerKey,session);
    if (!checkout || new Date(checkout.expiresAt) <= at) throw new AppError(409,'CHECKOUT_UNAVAILABLE');
    return { owned,checkout };
  }
  async function calculate(store,owner,input,session,at,orderId) {
    const current = await cart.getForCoupon(store,owner,{session,locale:null,at});
    if (!current.canCheckout) throw new AppError(409,'ORDER_CART_UNAVAILABLE');
    const discount = input.couponCode ? (orderId
      ? await coupons.redeem(store,owner,input.couponCode,input.customer.phone,{session,orderId,locale:null,at})
      : await coupons.previewForOrder(store,owner,input.couponCode,input.customer.phone,{session,locale:null,at})) : null;
    const fee = await shipping.resolve(store,input.address.governorateCode,{session});
    const categoryRows = await products.getOrderCategories(store, [...new Set(current.items.map(item => item.productId))], { session });
    const categoryByProduct = new Map(categoryRows.map(row => [row.productId, row.category]));
    const items = current.items.map((item,index) => ({ productId:item.productId,variantId:item.variantId,name:item.name,slug:item.slug,
      category:categoryByProduct.get(item.productId) ?? null,
      values:item.values,sku:item.sku,quantity:item.quantity,price:item.price,discountedPrice:item.discountedPrice,
      unitPrice:item.unitPrice,lineTotal:item.lineTotal,activeSale:item.activeSale,
      couponDiscount:discount?.allocations[index].discountAmount ?? 0,
      lineTotalAfterDiscount:discount?.allocations[index].lineTotalAfterDiscount ?? item.lineTotal }));
    return { current,preview:{ items,coupon:discount?.coupon ?? null,shipping:fee,
      totals:{subtotal:current.subtotal,discountAmount:discount?.discountAmount ?? 0,shippingFee:fee.fee,
        total:current.subtotal-(discount?.discountAmount ?? 0)+fee.fee},currency:'EGP',quotedAt:at.toISOString() } };
  }
  async function customerOrder(store,identity,orderId) {
    checkStore(store);const user = await auth.authorizeStaff(store,identity,['user']);
    const row = await repository.findById(store,ids(orderId));
    if (!row || String(row.userId) !== String(user._id)) throw new AppError(404,'ORDER_NOT_FOUND');return row;
  }
  async function staffOrder(store,identity,orderId) {
    checkStore(store);await auth.authorizeStaff(store,identity,staffRoles);
    const row = await repository.findById(store,ids(orderId));if (!row) throw new AppError(404,'ORDER_NOT_FOUND');return row;
  }
  async function trackingOrder(store,orderId,token) {
    checkStore(store);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(404,'ORDER_NOT_FOUND');
    const row = await repository.findTracking(store,ids(orderId));
    if (!row || row.userId || new Date(row.trackingExpiresAt) <= now()
      || !/^[a-f0-9]{64}$/.test(row.trackingHash) || !timingSafeEqual(Buffer.from(row.trackingHash,'hex'),Buffer.from(hash(token),'hex'))) throw new AppError(404,'ORDER_NOT_FOUND');
    return row;
  }
  async function proofBytes(store,row) {
    if (!row.payment.proofId) throw new AppError(404,'ORDER_PROOF_NOT_FOUND');
    const proof = await repository.findProof(store,row.payment.proofId);
    if (!proof || proof.status !== 'attached' || id(proof.orderId) !== id(row._id)) throw new AppError(404,'ORDER_PROOF_NOT_FOUND');
    return storage.read(proof.objectKey,{zone:proof.zone,endpoint:proof.endpoint});
  }
  return {
    async preview(store,owner,input,locale='en') {
      checkStore(store);const selected=inputFrom(input),at=now();
      return transaction(async session => {
        const owned=await cart.checkoutOwner(store,owner,session);await products.lockForCart(store,session);
        const settings=await repository.getSettings(store,session);
        if (selected.paymentMethod==='instapay') { storage.assertReady(); if (!settings?.receivingAccount) throw new AppError(503,'INSTAPAY_NOT_CONFIGURED'); }
        const {current,preview}=await calculate(store,owner,selected,session,at);
        preview.receivingAccount=selected.paymentMethod==='instapay' ? settings.receivingAccount : null;
        const expiresAt=new Date(at.getTime()+24*60*60*1000);
        const row=await repository.createCheckout({store,...owned,input:selected,preview,selections:selections(current),expiresAt},session);
        return {checkoutId:id(row._id),expiresAt:expiresAt.toISOString(),paymentMethod:selected.paymentMethod,...presentPreview(preview,locale)};
      });
    },
    async uploadProof(store,owner,checkoutId,buffer,contentType) {
      checkStore(store);const at=now();const {owned,checkout}=await scopedCheckout(store,owner,checkoutId,null,at);
      if (checkout.input.paymentMethod!=='instapay' || await repository.findByCheckout(store,checkout._id)) throw new AppError(409,'ORDER_PROOF_CONFLICT');
      storage.assertReady();const image=await processCatalogImage(buffer,contentType);const assetId=newId();
      // Persist the cleanup obligation before PUT: a timeout can still leave an object at Bunny.
      const proof=await repository.createProof({_id:assetId,store,checkoutId:checkout._id,ownerKey:owned.ownerKey,
        objectKey:`narmer/b2c/proofs/${assetId}.webp`,...storage.scope(),width:image.width,height:image.height,
        status:'uploading',expiresAt:checkout.expiresAt,orderId:null});
      await storage.upload(proof.objectKey,image.buffer);
      if (!await repository.readyProof(assetId,now())) throw new AppError(409,'ORDER_PROOF_CONFLICT');
      return {id:assetId,width:image.width,height:image.height,expiresAt:iso(proof.expiresAt)};
    },
    async place(store,owner,input,locale='en') {
      checkStore(store);const checkoutId=ids(input.checkoutId),proofId=input.proofId===undefined ? null : ids(input.proofId);
      const digest=hash(JSON.stringify([checkoutId,proofId]));const orderId=newId(),at=now();
      try { return await transaction(async session => {
        const owned=await cart.checkoutOwner(store,owner,session);await products.lockForCart(store,session);
        const existing=await repository.findByCheckout(store,checkoutId,session);
        if (existing) {
          if (existing.ownerKey!==owned.ownerKey) throw new AppError(404,'ORDER_NOT_FOUND');
          if (existing.requestDigest!==digest) throw new AppError(409,'ORDER_REQUEST_CONFLICT');
          return placementView(existing,locale,false);
        }
        const {checkout}=await scopedCheckout(store,owner,checkoutId,session,at);
        if (checkout.input.paymentMethod==='instapay' ? !proofId : proofId!==null) invalid();
        const current=await cart.getForCoupon(store,owner,{session,locale:null,at});
        if (selections(current)!==checkout.selections) throw new AppError(409,'CHECKOUT_CART_CHANGED');
        const {preview}=await calculate(store,owner,checkout.input,session,at,orderId);
        if (proofId && !await repository.attachProof(store,proofId,checkoutId,owned.ownerKey,orderId,at,session)) throw new AppError(409,'ORDER_PROOF_CONFLICT');
        await products.adjustOrderStock(store,preview.items,{session});
        const data={_id:orderId,store,...owned,checkoutId,requestDigest:digest,status:'pending',notificationLocale:locale,customer:checkout.input.customer,
          address:checkout.input.address,items:preview.items,totals:preview.totals,shipping:preview.shipping,coupon:preview.coupon,
          quotedPreview:checkout.preview,payment:{method:checkout.input.paymentMethod,proofId,receivingAccount:checkout.preview.receivingAccount,
            verifiedAt:null,verifiedBy:null,cashCollectedAt:null,cashCollectedBy:null},refund:null,stockRestored:false,
          history:[{status:'pending',at,actorId:null}],trackingExpiresAt:new Date(at.getTime()+90*24*60*60*1000)};
        data.trackingHash=hash(tokenFor(data));
        const row=await repository.create(data,session);await cart.consumeForOrder(store,owner,session);
        await notifications?.enqueue({ store, resourceId: orderId, event: 'order.placed', resourceStatus: 'pending',
          eventAt: at, to: row.customer.email, locale }, session);
        return placementView(row,locale,true);
      }); } catch(error) { if(error.code===11000) throw new AppError(409,'ORDER_REQUEST_CONFLICT');throw error; }
    },
    async list(store,identity,input={},locale='en',staff=false) {
      checkStore(store);const user=await auth.authorizeStaff(store,identity,staff ? staffRoles : ['user']);
      const page=input.page??1,limit=input.limit??20;
      const [rows,total]=await repository.list(store,{page,limit,status:input.status,...(staff?{}:{userId:user._id})});
      return {items:rows.map(row=>orderView(row,locale,staff)),pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
    },
    async getCustomer(store,identity,orderId,locale) { return orderView(await customerOrder(store,identity,orderId),locale); },
    async getStaff(store,identity,orderId,locale) { return orderView(await staffOrder(store,identity,orderId),locale,true); },
    async track(store,orderId,token,locale) { return orderView(await trackingOrder(store,orderId,token),locale); },
    async readCustomerProof(store,identity,orderId) {return proofBytes(store,await customerOrder(store,identity,orderId));},
    async readStaffProof(store,identity,orderId) {return proofBytes(store,await staffOrder(store,identity,orderId));},
    async readTrackingProof(store,orderId,token) {return proofBytes(store,await trackingOrder(store,orderId,token));},
    async changeStatus(store,identity,orderId,{status,expectedStatus},locale='en') {
      checkStore(store);if(!orderStatuses.includes(status)||!orderStatuses.includes(expectedStatus))invalid();
      return transaction(async session=>{
        const actor=await auth.authorizeStaff(store,identity,staffRoles,session);await products.lockForCart(store,session);
        const row=await repository.findById(store,ids(orderId),session);if(!row)throw new AppError(404,'ORDER_NOT_FOUND');
        if(row.status===status)return orderView(row,locale,true);
        if(row.status!==expectedStatus)throw new AppError(409,'ORDER_STATUS_CONFLICT');
        if(!transitions[row.status].includes(status))throw new AppError(409,'ORDER_STATUS_INVALID');
        const at=now(),fields={status};
        if(status==='canceled'||status==='returned'){
          if(row.stockRestored)throw new AppError(409,'ORDER_STATUS_CONFLICT');
          await products.adjustOrderStock(store,row.items,{session,restore:true});
          fields.stockRestored=true;fields.refund={amount:row.totals.total,at,actorId:actor._id};
        }
        if(status==='accepted'&&row.payment.method==='instapay'){
          fields['payment.verifiedAt']=at;fields['payment.verifiedBy']=actor._id;
        }
        if(status==='delivered'&&row.payment.method==='cod'){
          fields['payment.cashCollectedAt']=at;fields['payment.cashCollectedBy']=actor._id;
        }
        const changed=await repository.updateStatus(store,orderId,row.status,fields,{status,at,actorId:actor._id},session);
        if(!changed)throw new AppError(409,'ORDER_STATUS_CONFLICT');
        await notifications?.enqueue({ store, resourceId: id(changed._id), event: 'order.status', resourceStatus: status,
          eventAt: at, to: changed.customer.email, locale: changed.notificationLocale ?? 'en' }, session);
        return orderView(changed,locale,true);
      });
    },
    async getSettings(store,identity) {checkStore(store);await auth.authorizeStaff(store,identity,['superAdmin','admin']);return {receivingAccount:(await repository.getSettings(store))?.receivingAccount??null};},
    async setSettings(store,identity,input) {
      checkStore(store);const value=input.receivingAccount;
      if(value!==null&&(typeof value!=='string'||!value.trim()||value.trim().length>200))invalid();
      return transaction(async session=>{const actor=await auth.authorizeStaff(store,identity,['superAdmin','admin'],session);
        await products.lockForCart(store,session);const row=await repository.setSettings(store,value?.trim()??null,session);
        await repository.audit({store,actorId:actor._id,action:'settings.updated'},session);return {receivingAccount:row.receivingAccount};});
    },
    hasProductReferences:(...args)=>repository.hasProductReferences(...args),
    async getEmailSource(orderId) {
      const row = await repository.findTracking('b2c', ids(orderId)); if (!row) return null;
      const candidate = row.userId ? null : tokenFor(row);
      const valid = row.userId || (new Date(row.trackingExpiresAt) > now() && hash(candidate) === row.trackingHash);
      return { name: row.customer.name, total: row.totals.total, trackingToken: valid ? candidate : null, canTrack: Boolean(valid) };
    },
    async cleanupProofs() {
      storage.assertReady();const result={removed:0,failed:0};
      for(let batch=0;batch<25;batch++){
        const rows=await repository.cleanupCandidates(now());const before=result.removed;
        for(const row of rows){const proof=await repository.claimCleanup(row._id,now());if(!proof)continue;
          try{await storage.remove(proof.objectKey,{zone:proof.zone,endpoint:proof.endpoint});await repository.completeCleanup(proof._id);result.removed++;}
          catch{result.failed++;logger.error({event:'proof_cleanup_failed',assetId:id(proof._id)});}}
        if(rows.length<50||result.failed||result.removed===before)break;
      }return result;
    },
  };
}
