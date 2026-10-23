import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AppError } from '../src/shared/errors/app-error.js';
import { cartFixture } from './helpers/cart.js';
import { salesFixture,saleInput } from './helpers/sales.js';
import { couponsFixture,couponInput } from './helpers/coupons.js';
import { shippingFixture } from './helpers/shipping.js';
import { ordersFixture,checkoutInput } from './helpers/orders.js';
import { simpleInput,variantInput } from './helpers/products.js';
import { Order,OrderProof,Checkout } from '../src/modules/orders/orders.model.js';
import { createOrdersService } from '../src/modules/orders/orders.service.js';

const owner={_id:'1'.repeat(24),role:'superAdmin'},admin={_id:'2'.repeat(24),role:'admin'},mod={_id:'3'.repeat(24),role:'moderator'};
const customer={_id:'4'.repeat(24),role:'user'},other={_id:'5'.repeat(24),role:'user'};
const guest={guestToken:'a'.repeat(43)},stranger={guestToken:'b'.repeat(43)};
const auth={async authorizeStaff(store,identity,roles){if(store!=='b2c'||!roles.includes(identity?.role))throw new AppError(403,'FORBIDDEN');return identity;}};
async function fixture(){
  const p=cartFixture(auth),s=salesFixture(auth,p),c=couponsFixture(auth,{...p,sales:s.sales,transaction:s.transaction}),sh=shippingFixture(auth);
  await sh.shipping.setDefault('b2c',owner,{defaultFee:5000});
  const objects=new Map();let storageFailure=false;
  const storage={assertReady(){},scope:()=>({zone:'private',endpoint:'https://storage.bunnycdn.com'}),
    async upload(key,bytes){objects.set(key,Buffer.from(bytes));if(storageFailure)throw new AppError(502,'PROOF_STORAGE_FAILED');},
    async read(key){return objects.get(key);},async remove(key){if(storageFailure)throw new AppError(502,'PROOF_STORAGE_FAILED');objects.delete(key);}};
  const f=ordersFixture(auth,c,{shipping:sh.shipping,storage});
  f.at('2026-10-12T12:00:00Z');
  const category=await c.categories.create('b2c',owner,{name:{ar:'ملابس',en:'Clothing'},slug:'clothing'});
  const product=await c.products.create('b2c',owner,simpleInput(category.id));
  await c.cart.setItem('b2c',guest,{productId:product.id,quantity:2});
  return {...f,p,s,c,sh,category,product,objects,storage,failStorage(value){storageFailure=value;}};
}
const transition=(f,id,from,to)=>f.service.changeStatus('b2c',mod,id,{expectedStatus:from,status:to});

test('COD placement is atomic, snapshots current prices/fees, clears the cart and replays once even after quote expiry',async()=>{
  const f=await fixture(),quote=await f.service.preview('b2c',guest,checkoutInput());
  assert.equal(quote.totals.total,55000);assert.equal(quote.receivingAccount,null);assert.equal(quote.items[0].name,'Shirt');
  assert.equal(f.p.rows.get(f.product.id).stock,10);
  await f.c.products.update('b2c',admin,f.product.id,{version:0,price:30000});
  await f.sh.shipping.setDefault('b2c',owner,{defaultFee:6000});
  const placed=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId});
  assert.equal(placed.created,true);assert.equal(placed.order.totals.total,66000);
  await new Order(f.rows.get(placed.order.id)).validate();
  assert.deepEqual(placed.order.items[0].category, { id:f.category.id,name:'Clothing' });
  await f.c.categories.update('b2c',admin,f.category.id,{name:{en:'New category name',ar:'اسم جديد'}});
  assert.equal((await f.service.getStaff('b2c',mod,placed.order.id,'en')).items[0].category.name,'Clothing');
  assert.equal(placed.order.items[0].name,'Shirt');assert.equal(placed.order.payment.hasProof,false);
  assert.equal(f.p.rows.get(f.product.id).stock,8);assert.equal((await f.c.cart.get('b2c',guest)).items.length,0);
  assert.match(placed.trackingToken,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.service.getStaff('b2c',mod,placed.order.id,'en')).quotedPreview.totals.total,55000);
  assert.equal((await f.service.track('b2c',placed.order.id,placed.trackingToken,'ar')).items[0].name,'قميص');
  f.advance(2*24*60*60*1000);f.checkouts.clear();
  const retry=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId});
  assert.equal(retry.created,false);assert.equal(retry.trackingToken,placed.trackingToken);assert.equal(f.rows.size,1);assert.equal(f.p.rows.get(f.product.id).stock,8);
  await assert.rejects(f.service.place('b2c',stranger,{checkoutId:quote.checkoutId}),{code:'ORDER_NOT_FOUND'});
  await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId,proofId:'f'.repeat(24)}),{code:'ORDER_REQUEST_CONFLICT'});
  await assert.rejects(f.service.track('b2c',placed.order.id,'c'.repeat(43)),{code:'ORDER_NOT_FOUND'});
  f.advance(90*24*60*60*1000);await assert.rejects(f.service.track('b2c',placed.order.id,placed.trackingToken),{code:'ORDER_NOT_FOUND'});
});

test('Failed placement rolls back coupon use, stock, proof attachment and cart; cancel retains coupon use and restores once',async()=>{
  const f=await fixture();const coupon=await f.c.coupons.create('b2c',admin,couponInput({maxUses:1,maxUsesPerPerson:1}));
  const quote=await f.service.preview('b2c',guest,checkoutInput({couponCode:coupon.code}));
  assert.equal(f.c.redemptions.length,0);assert.equal(quote.totals.total,45000);
  f.failWrite(true);await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId}),/order write failed/);
  assert.equal(f.c.rows.get(coupon.id).usedCount,0);assert.equal(f.c.redemptions.length,0);assert.equal(f.p.rows.get(f.product.id).stock,10);
  assert.equal((await f.c.cart.get('b2c',guest)).itemCount,2);assert.equal(f.rows.size,0);
  f.failWrite(false);const placed=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId});
  assert.equal(f.c.rows.get(coupon.id).usedCount,1);assert.equal(f.c.redemptions.length,1);
  const canceled=await transition(f,placed.order.id,'pending','canceled');
  assert.equal(canceled.stockRestored,true);assert.equal(canceled.refund.amount,45000);assert.equal(canceled.payment.cashCollectedAt,null);
  await transition(f,placed.order.id,'pending','canceled');assert.equal(f.p.rows.get(f.product.id).stock,10);
  assert.equal(f.c.rows.get(coupon.id).usedCount,1);assert.equal(f.c.redemptions.length,1);assert.equal(f.rows.get(placed.order.id).history.length,2);
  await assert.rejects(transition(f,placed.order.id,'canceled','accepted'),{code:'ORDER_STATUS_INVALID'});
});

test('Stock races, cart changes and expired checkout fail without creating orders or consuming coupons',async()=>{
  const f=await fixture(),quote=await f.service.preview('b2c',guest,checkoutInput());
  await f.c.cart.setItem('b2c',guest,{productId:f.product.id,quantity:3});
  await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId}),{code:'CHECKOUT_CART_CHANGED'});
  await f.c.cart.setItem('b2c',guest,{productId:f.product.id,quantity:2});
  f.p.rows.get(f.product.id).stock=1;
  await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId}),{code:'ORDER_CART_UNAVAILABLE'});
  assert.equal(f.rows.size,0);assert.equal((await f.c.cart.get('b2c',guest)).itemCount,2);
  f.advance(24*60*60*1000);await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId}),{code:'CHECKOUT_UNAVAILABLE'});
});

test('Signing-key rotation preserves original guest tracking and never returns an invalid regenerated token on replay',async()=>{
  const f=await fixture(),quote=await f.service.preview('b2c',guest,checkoutInput());
  const placed=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId});
  const rotated=createOrdersService({auth,cart:f.c.cart,products:f.c.products,coupons:f.c.coupons,shipping:f.sh.shipping,
    storage:f.storage,repository:f.repository,transaction:f.transaction,now:f.now,trackingSecret:'changed-key'});
  const replay=await rotated.place('b2c',guest,{checkoutId:quote.checkoutId});
  assert.equal(replay.created,false);assert.equal(replay.trackingToken,null);assert.equal(replay.trackingExpiresAt,placed.trackingExpiresAt);
  assert.equal((await rotated.track('b2c',placed.order.id,placed.trackingToken,'en')).id,placed.order.id);
  assert.equal(f.rows.size,1);assert.equal(f.p.rows.get(f.product.id).stock,8);
});

test('Status changes enforce the graph, expected status, offline payment facts and transaction-safe restoration',async()=>{
  const f=await fixture(),quote=await f.service.preview('b2c',guest,checkoutInput());
  const placed=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId}),oid=placed.order.id;
  await assert.rejects(transition(f,oid,'pending','delivered'),{code:'ORDER_STATUS_INVALID'});
  await assert.rejects(f.service.changeStatus('b2c',customer,oid,{status:'canceled',expectedStatus:'pending'}),{code:'FORBIDDEN'});
  await transition(f,oid,'pending','accepted');
  await assert.rejects(transition(f,oid,'pending','canceled'),{code:'ORDER_STATUS_CONFLICT'});
  await transition(f,oid,'accepted','shipped');await assert.rejects(transition(f,oid,'shipped','canceled'),{code:'ORDER_STATUS_INVALID'});
  const delivered=await transition(f,oid,'shipped','delivered');assert.ok(delivered.payment.cashCollectedAt);assert.equal(delivered.payment.verifiedAt,null);
  f.failWrite(true);await assert.rejects(transition(f,oid,'delivered','returned'),/order write failed/);
  assert.equal(f.p.rows.get(f.product.id).stock,8);assert.equal(f.rows.get(oid).status,'delivered');
  f.failWrite(false);const returned=await transition(f,oid,'delivered','returned');
  assert.equal(returned.refund.amount,55000);assert.equal(f.p.rows.get(f.product.id).stock,10);assert.equal(returned.history.length,5);
  await transition(f,oid,'delivered','returned');assert.equal(f.p.rows.get(f.product.id).stock,10);
});

test('Account order ownership, guest privacy, bilingual snapshots and historical variant references survive catalog changes',async()=>{
  const f=await fixture(),variant=await f.c.products.create('b2c',owner,variantInput(f.category.id));
  const accountOwner={identity:customer};await f.c.cart.setItem('b2c',accountOwner,{productId:variant.id,variantId:variant.variants[0].id,quantity:2});
  const quote=await f.service.preview('b2c',accountOwner,checkoutInput()),placed=await f.service.place('b2c',accountOwner,{checkoutId:quote.checkoutId});
  assert.equal(placed.trackingToken,null);assert.equal(placed.trackingExpiresAt,null);
  await new Order(f.rows.get(placed.order.id)).validate();
  assert.equal(f.p.rows.get(variant.id).variants[0].stock,3);
  assert.equal((await f.service.list('b2c',customer)).pagination.total,1);assert.equal((await f.service.list('b2c',other)).pagination.total,0);
  await assert.rejects(f.service.getCustomer('b2c',other,placed.order.id),{code:'ORDER_NOT_FOUND'});
  await assert.rejects(f.service.getCustomer('b2c',customer,'f'.repeat(24)),{code:'ORDER_NOT_FOUND'});
  assert.equal(await f.service.hasProductReferences('b2c',variant.id,[variant.variants[0].id]),true);
  assert.equal(await f.service.hasProductReferences('b2c',variant.id,[variant.variants[1].id]),false);
  await f.c.products.update('b2c',admin,variant.id,{version:1,name:{en:'Renamed'}});
  assert.equal((await f.service.getCustomer('b2c',customer,placed.order.id,'en')).items[0].name,'Shirt');
  await transition(f,placed.order.id,'pending','canceled');assert.equal(f.p.rows.get(variant.id).variants[0].stock,5);
  assert.equal(await f.service.hasProductReferences('b2c',variant.id),true);
});

test('Private InstaPay proof uses verified image bytes, quote ownership, account snapshot and manual acceptance',async()=>{
  const f=await fixture();await assert.rejects(f.service.preview('b2c',guest,checkoutInput({paymentMethod:'instapay'})),{code:'INSTAPAY_NOT_CONFIGURED'});
  await assert.rejects(f.service.setSettings('b2c',mod,{receivingAccount:'bank'}),{code:'FORBIDDEN'});
  await f.service.setSettings('b2c',admin,{receivingAccount:'old-account'});
  const quote=await f.service.preview('b2c',guest,checkoutInput({paymentMethod:'instapay'}));
  await f.service.setSettings('b2c',admin,{receivingAccount:'new-account'});
  await assert.rejects(f.service.uploadProof('b2c',stranger,quote.checkoutId,Buffer.from('bad'),'image/png'),{code:'CHECKOUT_UNAVAILABLE'});
  await assert.rejects(f.service.uploadProof('b2c',guest,quote.checkoutId,Buffer.from('bad'),'image/png'),{code:'INVALID_IMAGE'});
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer();
  const proof=await f.service.uploadProof('b2c',guest,quote.checkoutId,bytes,'image/png');
  assert.deepEqual(Object.keys(proof).sort(),['expiresAt','height','id','width']);assert.equal(f.proofs.get(proof.id).status,'ready');
  f.failWrite(true);await assert.rejects(f.service.place('b2c',guest,{checkoutId:quote.checkoutId,proofId:proof.id}),/order write failed/);assert.equal(f.proofs.get(proof.id).status,'ready');
  f.failWrite(false);const placed=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId,proofId:proof.id});
  assert.equal(placed.order.payment.receivingAccount,'old-account');assert.equal(placed.order.payment.hasProof,true);assert.equal(f.proofs.get(proof.id).status,'attached');
  await new Order(f.rows.get(placed.order.id)).validate();
  const read=await f.service.readTrackingProof('b2c',placed.order.id,placed.trackingToken);assert.equal((await sharp(read).metadata()).format,'webp');
  await assert.rejects(f.service.readCustomerProof('b2c',customer,placed.order.id),{code:'ORDER_NOT_FOUND'});
  await assert.rejects(f.service.uploadProof('b2c',guest,quote.checkoutId,bytes,'image/png'),{code:'ORDER_PROOF_CONFLICT'});
  const accepted=await transition(f,placed.order.id,'pending','accepted');assert.ok(accepted.payment.verifiedAt);assert.equal(accepted.payment.verifiedBy,mod._id);
  f.advance(2*24*60*60*1000);assert.deepEqual(await f.service.cleanupProofs(),{removed:0,failed:0});assert.equal(f.objects.size,1);
});

test('Timed sales exclude only their lines from order coupon allocation and snapshot bilingual campaign names',async()=>{
  const f=await fixture(),second=await f.c.products.create('b2c',owner,simpleInput(f.category.id,'second'));
  await f.c.cart.setItem('b2c',guest,{productId:second.id,quantity:1});
  await f.s.sales.create('b2c',admin,{...saleInput(f.product.id),startsAt:'2020-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z'});
  const coupon=await f.c.coupons.create('b2c',admin,couponInput());
  const quote=await f.service.preview('b2c',guest,checkoutInput({couponCode:coupon.code}),'ar');
  assert.equal(quote.items[0].couponDiscount,0);assert.equal(quote.items[1].couponDiscount,5000);assert.equal(typeof quote.items[0].activeSale.name,'string');
  const order=await f.service.place('b2c',guest,{checkoutId:quote.checkoutId},'en');assert.equal(typeof order.order.items[0].activeSale.name,'string');
});

test('Failed Bunny uploads keep durable cleanup work; failed cleanup retries and never deletes attached proof',async()=>{
  const f=await fixture();await f.service.setSettings('b2c',owner,{receivingAccount:'account'});
  const quote=await f.service.preview('b2c',guest,checkoutInput({paymentMethod:'instapay'}));
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
  f.failStorage(true);await assert.rejects(f.service.uploadProof('b2c',guest,quote.checkoutId,bytes,'image/png'),{code:'PROOF_STORAGE_FAILED'});
  assert.equal(f.proofs.size,1);assert.equal(f.objects.size,1);f.advance(24*60*60*1000);
  assert.deepEqual(await f.service.cleanupProofs(),{removed:0,failed:1});assert.equal([...f.proofs.values()][0].status,'deletePending');
  f.failStorage(false);assert.deepEqual(await f.service.cleanupProofs(),{removed:1,failed:0});assert.equal(f.proofs.size,0);assert.equal(f.objects.size,0);
  f.failWrite(true);await assert.rejects(f.service.setSettings('b2c',admin,{receivingAccount:'changed'}),/order write failed/);
  assert.equal((await f.service.getSettings('b2c',admin)).receivingAccount,'account');
});

test('Order models require complete snapshots and unique checkout IDs without TTL deletion of orders or proof obligations',async()=>{
  assert.ok(Order.schema.indexes().some(([keys,options])=>keys.checkoutId===1&&options.unique));
  assert.equal(Order.schema.indexes().some(([,options])=>options.expireAfterSeconds!==undefined),false);
  assert.equal(OrderProof.schema.indexes().some(([,options])=>options.expireAfterSeconds!==undefined),false);
  assert.ok(Checkout.schema.indexes().some(([keys,options])=>keys.expiresAt===1&&options.expireAfterSeconds===0));
  await assert.rejects(new Order({store:'b2c'}).validate(),{name:'ValidationError'});
});
