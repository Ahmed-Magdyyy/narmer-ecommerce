import { emptyLeadsRepository } from './helpers/leads.js';
import { emptyWholesaleRepository } from './helpers/wholesale.js';
import { emptyWishlistRepository } from './helpers/wishlist.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from '../src/app/app.js';
import { createBusinessRouter } from '../src/app/modules.js';
import { identityFixture } from './helpers/identity.js';
import { cartFixture } from './helpers/cart.js';
import { shippingFixture } from './helpers/shipping.js';
import { emptySalesRepository } from './helpers/sales.js';
import { emptyCouponsRepository } from './helpers/coupons.js';
import { ordersFixture,checkoutInput } from './helpers/orders.js';
import { simpleInput } from './helpers/products.js';
import { testConfig } from './helpers/config.js';
import { emptyNotificationsRepository } from './helpers/notifications.js';

test('Checkout and Orders HTTP enforces guest/customer/staff ownership, private proof, validation, retry and deletion restrictions',async t=>{
  const f=identityFixture(),p=cartFixture(f.auth),sh=shippingFixture(f.auth);
  const {input}=await f.verified();await f.auth.provisionSuperAdmin('b2c',input.email);
  const superToken=(await f.auth.login('b2c',input.email,input.password)).accessToken,superIdentity=await f.auth.authenticate('b2c',superToken);
  const tokens={superAdmin:superToken};
  for(const role of ['admin','moderator','user','other']){
    const email=`orders-${role}@example.com`;await f.auth.register('b2c',{...input,email},'en');await f.auth.verifyEmail('b2c',email,f.emails.at(-1).code);
    const user=await f.users.findAccountByEmail('b2c',email);f.accounts.get(user._id).role=role==='other'?'user':role;
    tokens[role]=(await f.auth.login('b2c',email,input.password)).accessToken;
  }
  await sh.shipping.setDefault('b2c',superIdentity,{defaultFee:5000});
  const objects=new Map(),storage={assertReady(){},scope:()=>({zone:'private',endpoint:'https://storage.bunnycdn.com'}),
    async upload(key,bytes){objects.set(key,Buffer.from(bytes));},async read(key){return objects.get(key);},async remove(key){objects.delete(key);}};
  const o=ordersFixture(f.auth,p,{shipping:sh.shipping,storage});
  const category=await p.categories.create('b2c',superIdentity,{name:{ar:'ملابس',en:'Clothing'},slug:'clothing'});
  const product=await p.products.create('b2c',superIdentity,simpleInput(category.id));
  const app=createApp(testConfig,{apiRouter:createBusinessRouter(testConfig,{ submissionRepository: emptyLeadsRepository, offerRepository: emptyWholesaleRepository, favoritesRepository: emptyWishlistRepository,users:f.users,email:f.email,repository:f.repository,userRepository:f.userRepository,
    staffNotificationRepository:emptyNotificationsRepository,categoryRepository:p.categoryRepository,productRepository:p.repository,shoppingRepository:p.cartRepository,deliveryRepository:sh.repository,
    campaignRepository:emptySalesRepository,discountRepository:emptyCouponsRepository,orderRepository:o.repository,proofStorage:storage,transaction:o.transaction}),isReady:()=>true,logger:{info(){},error(){}}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  async function req(path,{method='GET',token,cookie,body,raw,type='image/png',origin=testConfig.corsOrigins[0],tracking,locale='en'}={}){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${path}`,{method,
      headers:{'X-Language':locale,...(origin?{Origin:origin}:{}),...(token?{Authorization:`Bearer ${token}`} :{}),...(cookie?{Cookie:cookie}:{}),
        ...(tracking?{'X-Order-Token':tracking}:{}),...(raw?{'Content-Type':type}:body?{'Content-Type':'application/json'}:{})},
      ...(raw?{body:raw}:body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:response.headers.get('content-type')?.startsWith('image/')?Buffer.from(await response.arrayBuffer()):await response.json(),
      cache:response.headers.get('cache-control'),type:response.headers.get('content-type'),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const guest=await req('b2c/cart'),cookie=guest.cookie;assert.equal(p.cartRows.size,1);
  await req('b2c/cart/items',{method:'PUT',cookie,body:{productId:product.id,quantity:2}});
  for(const body of [{},{...checkoutInput(),customer:{name:'a',email:'bad',phone:'01001234567'}},{...checkoutInput(),paymentMethod:'card'},{...checkoutInput(),couponCode:null}]){
    assert.equal((await req('b2c/cart/checkout',{method:'POST',cookie,body})).status,422);
  }
  assert.equal((await req('b2c/cart/checkout',{method:'POST',cookie,origin:null,body:checkoutInput()})).status,403);
  assert.equal((await req('b2c/cart/checkout',{method:'POST',token:tokens.admin,body:checkoutInput()})).status,403);
  const quote=await req('b2c/cart/checkout',{method:'POST',cookie,locale:'ar',body:{...checkoutInput(),total:1,userId:'f'.repeat(24)}});
  assert.equal(quote.status,200);assert.equal(quote.cache,'no-store');assert.equal(quote.data.data.items[0].name,'قميص');
  assert.equal(quote.data.data.totals.total,55000);assert.equal(quote.data.data.receivingAccount,null);
  const placement={checkoutId:quote.data.data.checkoutId},created=await req('b2c/cart/checkout/orders',{method:'POST',cookie,body:{...placement,status:'delivered',totals:{total:0}}});
  assert.equal(created.status,201);assert.equal(created.data.data.order.status,'pending');assert.equal(created.data.data.order.totals.total,55000);
  assert.deepEqual(Object.keys(created.data.data).sort(),['order','trackingExpiresAt','trackingToken']);
  const oid=created.data.data.order.id,tracking=created.data.data.trackingToken;
  assert.equal((await req('b2c/cart/checkout/orders',{method:'POST',cookie,body:placement})).status,200);
  assert.equal((await req(`b2c/orders/tracking/${oid}`)).status,404);
  assert.equal((await req(`b2c/orders/tracking/${oid}`,{tracking})).status,200);
  assert.equal((await req(`b2c/orders/tracking/${oid}/proof`,{tracking})).data.code,'ORDER_PROOF_NOT_FOUND');
  assert.equal((await req(`b2c/orders/${oid}`,{token:tokens.user})).status,404);
  assert.equal((await req('b2c/orders',{token:tokens.user})).data.data.pagination.total,0);
  assert.equal((await req('admin/b2c/orders',{token:tokens.moderator})).data.data.pagination.total,1);
  const staffDetail=await req(`admin/b2c/orders/${oid}`,{token:tokens.moderator});
  assert.equal(staffDetail.status,200);assert.equal(staffDetail.data.data.items[0].category.id,category.id);
  const capturedCategory=o.rows.get(oid).items[0].category;
  o.rows.get(oid).items[0].category=null;
  assert.equal((await req(`admin/b2c/orders/${oid}`,{token:tokens.moderator})).data.data.items[0].category,null);
  o.rows.get(oid).items[0].category=capturedCategory;
  assert.equal((await req('admin/b2c/orders',{token:tokens.user})).status,403);
  assert.equal((await req('admin/b2c/orders?limit=0',{token:superToken})).status,422);
  assert.equal((await req('admin/b2c/orders/settings',{token:tokens.moderator})).status,403);
  assert.equal((await req('admin/b2c/orders/settings',{method:'PATCH',token:tokens.admin,body:{receivingAccount:12}})).status,422);
  assert.equal((await req('admin/b2c/orders/settings',{method:'PATCH',token:tokens.admin,body:{receivingAccount:' narmer@instapay '}})).data.data.receivingAccount,'narmer@instapay');
  const accepted=await req(`admin/b2c/orders/${oid}/status`,{method:'PATCH',token:tokens.moderator,body:{status:'accepted',expectedStatus:'pending'}});
  assert.equal(accepted.status,200);assert.ok(accepted.data.data.quotedPreview);assert.equal(accepted.data.data.stockRestored,false);
  assert.equal((await req(`admin/b2c/orders/${oid}/status`,{method:'PATCH',token:tokens.admin,body:{status:'canceled',expectedStatus:'pending'}})).data.code,'ORDER_STATUS_CONFLICT');
  assert.equal((await req(`admin/b2c/products/${product.id}`,{method:'DELETE',token:superToken})).data.code,'PRODUCT_REFERENCED');
  assert.equal((await req(`admin/b2c/orders/${oid}`,{method:'DELETE',token:superToken})).status,404);
  assert.equal((await req(`b2c/orders/${oid}/status`,{method:'PATCH',token:tokens.user,body:{status:'canceled'}})).status,404);
  const cancel=await req(`admin/b2c/orders/${oid}/status`,{method:'PATCH',token:tokens.moderator,body:{status:'canceled',expectedStatus:'accepted'}});
  assert.equal(cancel.status,200);assert.equal(cancel.data.data.refund.amount,55000);assert.equal(p.rows.get(product.id).stock,10);
  await req('b2c/cart/items',{method:'PUT',cookie,body:{productId:product.id,quantity:1}});
  const ip=await req('b2c/cart/checkout',{method:'POST',cookie,body:checkoutInput({paymentMethod:'instapay'})});
  const cid=ip.data.data.checkoutId;
  assert.equal((await req(`b2c/cart/checkout/${cid}/proof`,{method:'POST',cookie,raw:Buffer.from('fake'),type:'application/pdf'})).status,415);
  assert.equal((await req(`b2c/cart/checkout/${cid}/proof`,{method:'POST',cookie,raw:Buffer.from('fake')})).status,422);
  const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).png().toBuffer();
  const proof=await req(`b2c/cart/checkout/${cid}/proof`,{method:'POST',cookie,raw:bytes});assert.equal(proof.status,201);
  const ipOrder=await req('b2c/cart/checkout/orders',{method:'POST',cookie,body:{checkoutId:cid,proofId:proof.data.data.id}});
  assert.equal(ipOrder.status,201);const iid=ipOrder.data.data.order.id;
  const image=await req(`admin/b2c/orders/${iid}/proof`,{token:tokens.moderator});assert.equal(image.status,200);assert.equal(image.type,'image/webp');assert.equal(image.cache,'no-store');
  assert.equal((await req(`b2c/orders/tracking/${iid}/proof`,{tracking:ipOrder.data.data.trackingToken})).status,200);
  assert.equal((await req(`b2c/orders/${iid}/proof`,{token:tokens.user})).status,404);
  assert.equal((await req(`b2b/orders/${iid}`,{token:tokens.user})).status,404);
  await req('b2c/cart/items',{method:'PUT',token:tokens.user,body:{productId:product.id,quantity:1}});
  const userQuote=await req('b2c/cart/checkout',{method:'POST',token:tokens.user,body:checkoutInput()});
  const userOrder=await req('b2c/cart/checkout/orders',{method:'POST',token:tokens.user,body:{checkoutId:userQuote.data.data.checkoutId}});
  assert.equal(userOrder.data.data.trackingToken,null);assert.equal((await req(`b2c/orders/${userOrder.data.data.order.id}`,{token:tokens.user})).status,200);
  assert.equal((await req(`b2c/orders/${userOrder.data.data.order.id}`,{token:tokens.other})).status,404);
  assert.equal((await req('b2c/orders',{token:tokens.user})).data.data.pagination.total,1);
});
