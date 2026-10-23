import { randomBytes } from 'node:crypto';
import { createOrdersService } from '../../src/modules/orders/orders.service.js';

export const emptyOrdersRepository = { async hasProductReferences() { return false; } };
export const checkoutInput = (fields={}) => ({ customer:{name:'Ahmed',email:'buyer@example.com',phone:'01001234567'},
  address:{governorateCode:'cairo',governorate:'Cairo',district:'Nasr City',building:'12',street:'Main Street'},paymentMethod:'cod',...fields });

export function ordersFixture(auth,catalog,{shipping,storage,trackingSecret='test-order-tracking-secret'}={}) {
  const rows=new Map(),checkouts=new Map(),proofs=new Map(),audits=[],settings=new Map();
  const copy=structuredClone;let clock=new Date(),failure=false;
  const now=()=>new Date(clock),newId=()=>randomBytes(12).toString('hex');
  const owned=(rows,store,id)=>{const row=rows.get(String(id));return row?.store===store ? row : null;};
  const expired=row=>row.status==='deletePending'||(['uploading','ready'].includes(row.status)&&row.expiresAt<=now());
  const repository={
    async getSettings(store){return copy(settings.get(store)??null);},
    async setSettings(store,receivingAccount){const row={receivingAccount};settings.set(store,row);return copy(row);},
    async audit(data){if(failure)throw new Error('order write failed');audits.push(copy(data));},
    async createCheckout(data){const row={...copy(data),_id:newId(),createdAt:now(),updatedAt:now()};checkouts.set(row._id,row);return copy(row);},
    async findCheckout(store,id,ownerKey){const row=owned(checkouts,store,id);return copy(row?.ownerKey===ownerKey ? row : null);},
    async create(data){if(failure)throw new Error('order write failed');
      if([...rows.values()].some(row=>row.store===data.store&&row.checkoutId===data.checkoutId))throw Object.assign(new Error('duplicate'),{code:11000});
      const row={...copy(data),createdAt:now(),updatedAt:now()};rows.set(row._id,row);return copy(row);},
    async findByCheckout(store,id){return copy([...rows.values()].find(row=>row.store===store&&String(row.checkoutId)===String(id))??null);},
    async findById(store,id){return copy(owned(rows,store,id));},async findTracking(store,id){return copy(owned(rows,store,id));},
    async list(store,{page,limit,status,userId}){const filtered=[...rows.values()].filter(row=>row.store===store&&(!status||row.status===status)&&(!userId||row.userId===String(userId)));
      return [copy(filtered.slice((page-1)*limit,page*limit)),filtered.length];},
    async updateStatus(store,id,previous,fields,event){if(failure)throw new Error('order write failed');const row=owned(rows,store,id);if(row?.status!==previous)return null;
      for(const [key,value]of Object.entries(fields)){if(key.startsWith('payment.'))row.payment[key.slice(8)]=copy(value);else row[key]=copy(value);}
      row.history.push(copy(event));row.updatedAt=now();return copy(row);},
    async hasProductReferences(store,productId,variantIds){return [...rows.values()].some(row=>row.store===store&&row.items.some(item=>item.productId===productId&&(!variantIds||variantIds.includes(item.variantId))));},
    async createProof(data){const row={...copy(data),createdAt:now(),updatedAt:now()};proofs.set(row._id,row);return copy(row);},
    async readyProof(id,at){const row=proofs.get(id);if(row?.status!=='uploading'||row.expiresAt<=at)return null;row.status='ready';return copy(row);},
    async findProof(store,id){return copy(owned(proofs,store,id));},
    async attachProof(store,id,checkoutId,ownerKey,orderId,at){const row=owned(proofs,store,id);
      if(row?.status!=='ready'||String(row.checkoutId)!==String(checkoutId)||row.ownerKey!==ownerKey||row.expiresAt<=at)return null;
      row.status='attached';row.orderId=orderId;return copy(row);},
    async cleanupCandidates(){return copy([...proofs.values()].filter(expired).slice(0,50));},
    async claimCleanup(id){const row=proofs.get(id);if(!row||!expired(row))return null;row.status='deletePending';return copy(row);},
    async completeCleanup(id){if(proofs.get(id)?.status==='deletePending')proofs.delete(id);},
  };
  const transaction=work=>catalog.transaction(async session=>{
    const snapshots=[rows,checkouts,proofs,settings].map(map=>copy([...map])),before=copy(audits);
    try{return await work(session);}catch(error){[rows,checkouts,proofs,settings].forEach((map,index)=>{map.clear();for(const [key,value]of snapshots[index])map.set(key,value);});audits.splice(0,audits.length,...before);throw error;}
  });
  const service=createOrdersService({auth,cart:catalog.cart,products:catalog.products,coupons:catalog.coupons,shipping,storage,trackingSecret,repository,transaction,now,logger:{error(){}}});
  return {service,repository,rows,checkouts,proofs,audits,settings,transaction,now,at(value){clock=new Date(value);},advance(ms){clock=new Date(clock.getTime()+ms);},failWrite(value){failure=value;}};
}
