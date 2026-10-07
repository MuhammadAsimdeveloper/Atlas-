import crypto from 'node:crypto';

const ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const CURRENCIES=new Set(['USD']);
const PRODUCT_TYPES=new Set(['physical','digital','service']);
const PRODUCT_STATUS=new Set(['draft','active','archived']);
const QUOTE_STATUS=['draft','sent','accepted','declined','expired','canceled'];
const ORDER_STATUS=['draft','pending_payment','paid','fulfilled','canceled','refunded'];
const SUBSCRIPTION_STATUS=['trialing','active','past_due','paused','canceled'];
const PAYMENT_STATUS=['requires_payment_method','requires_action','authorized','captured','failed','refunded','partially_refunded'];
const PORTAL_ROLES=new Set(['customer','partner','freelancer','agency','vendor']);
const PORTAL_RESOURCES=new Set(['records','tasks','messages','files','contracts','payments','appointments','reports','approvals']);
const TASK_STATUS=new Set(['todo','in_progress','blocked','done','canceled']);

const freeze=v=>Object.freeze(v);
const clone=v=>structuredClone(v);
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
function assertId(v,l='id'){if(typeof v!=='string'||!ID.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_id'});return v;}
function assertRef(v,l='reference'){if(typeof v!=='string'||!REF.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_reference'});return v;}
function text(v,l,max=500){if(typeof v!=='string'||!v.trim()||v.length>max)throw new TypeError(l+' invalid');return v.trim();}
function money(v,l='amountMinor'){if(!Number.isSafeInteger(v)||v<0)throw new RangeError(l+' must be a non-negative safe integer');return v;}
function positiveMoney(v,l){money(v,l);if(v<1)throw new RangeError(l+' must be positive');return v;}
function currency(v='USD'){if(!CURRENCIES.has(v))throw new TypeError('unsupported currency');return v;}
function idem(v){if(!/^[A-Za-z0-9._:-]{8,255}$/.test(v||''))throw new TypeError('invalid idempotency key');return v;}
function boundedInt(v,l,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)throw new RangeError(l+' out of bounds');return v;}
function safeArray(v,l,max){if(!Array.isArray(v)||v.length>max)throw new RangeError(l+' out of bounds');return v;}

export function defineProduct({tenantId,productId,name,type='service,status='active',description='',variants=[]}={}){
  assertRef(tenantId,'tenantId');assertId(productId,'productId');text(name,'name',160);if(!PRODUCT_TYPES.has(type)||!PRODUCT_STATUS.has(status))throw new TypeError('product type/status invalid');
  text(description||'','description',2000);safeArray(variants,'variants',500);
  const seen=new Set();
  const normalized=variants.map((variant)=>{
    assertId(variant.id,'variantId');if(seen.has(variant.id))throw new TypeError('duplicate variant');seen.add(variant.id);
    const sku=text(variant.sku,'sku',80);if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(sku))throw new TypeError('sku invalid');
    const attrs=variant.attributes&&typeof variant.attributes==='object'&&!Array.isArray(variant.attributes)?clone(variant.attributes):{};
    return {id:variant.id,sku,name:text(variant.name||variant.sku,'variant name',160),attributes:attrs,active:variant.active!==false};
  });
  const body={tenantId,productId,name:text(name,'name',160),type,status,description:description||'',variants:normalized};
  return freeze({...body,checksum:hash(body)});
}

export function definePriceBook({tenantId,priceBookId,name,currencyCode='USD',entries=[],defaultBook=false}={}){
  assertRef(tenantId,'tenantId');assertId(priceBookId,'priceBookId');text(name,'name',160);currency(currencyCode);safeArray(entries,'entries',5000);
  const seen=new Set();
  const normalized=entries.map(e=>{
    assertId(e.productId,'productId');assertId(e.variantId,'variantId');if(seen.has(e.variantId))throw new TypeError('duplicate price entry');seen.add(e.variantId);
    return {productId:e.productId,variantId:e.variantId,unitPriceMinor:positiveMoney(e.unitPriceMinor,'unitPriceMinor'),minQuantity:boundedInt(e.minQuantity??1,'minQuantity',1,100000),active:e.active!==false};
  });
  const body={tenantId,priceBookId,name:text(name,'name',160),currency:currencyCode,entries:normalized,defaultBook:Boolean(defaultBook)};
  return freeze({...body,checksum:hash(body)});
}

export function defineTaxPolicy({tenantId,taxPolicyId,name,rateBps=0,compound=false,maxTaxMinor=null}={}){
  assertRef(tenantId,'tenantId');assertId(taxPolicyId,'taxPolicyId');text(name,'name',160);boundedInt(rateBps,'rateBps',0,10000);
  if(maxTaxMinor!==null)money(maxTaxMinor,'maxTaxMinor');
  const body={tenantId,taxPolicyId,name:text(name,'name',160),rateBps,compound:Boolean(compound),maxTaxMinor};
  return freeze({...body,checksum:hash(body)});
}

export function defineCoupon({tenantId,couponId,code,kind='percent',value,minimumSubtotalMinor=0,maxRedemptions=100000,expiresAt=null}={}){
  assertRef(tenantId,'tenantId');assertId(couponId,'couponId');code=text(code,'code',40).toUpperCase();money(minimumSubtotalMinor,'minimumSubtotalMinor');boundedInt(maxRedemptions,'maxRedemptions',1,100000000);
  if(!['percent','fixed'].includes(kind))throw new TypeError('coupon kind invalid');
  if(kind==='percent')boundedInt(value,'percent value',1,10000);else positiveMoney(value,'coupon value');
  if(expiresAt!==null&&!Number.isFinite(Date.parse(expiresAt)))throw new TypeError('expiresAt invalid');
  const body={tenantId,couponId,code,kind,value,minimumSubtotalMinor,maxRedemptions,expiresAt:expiresAt?new Date(expiresAt).toISOString():null};
  return freeze({...body,checksum:hash(body)});
}

export function createCart({tenantId,cartId,customerRef=null,currencyCode='USD',lines=[]}={}){
  assertRef(tenantId,'tenantId');assertId(cartId,'cartId');currency(currencyCode);safeArray(lines,'lines',200);
  const normalized=lines.map(l=>({productId:assertId(l.productId,'productId'),variantId:assertId(l.variantId,'variantId'),quantity:boundedInt(l.quantity,'quantity',1,100000)}));
  return freeze({tenantId,cartId,customerRef:customerRef?assertRef(customerRef,'customerRef'):null,currency:currencyCode,lines:normalized,status:'open',version:1,cartHash:hash({tenantId,cartId,customerRef,currency:currencyCode,lines:normalized})});
}

export function priceCart({cart,products,priceBook,taxPolicy=null,coupon=null,redeemedCount=0}={}){
  if(!cart||cart.status!=='open')throw new TypeError('open cart required');
  if(!priceBook||priceBook.tenantId!==cart.tenantId||priceBook.currency!==cart.currency)throw new Error('price book mismatch');
  if(!Array.isArray(products))throw new TypeError('products required');
  const productMap=new Map(products.map(p=>[p.productId,p]));
  const entries=new Map(priceBook.entries.map(e=>[e.variantId,e]));
  const priced=cart.lines.map(line=>{
    const p=productMap.get(line.productId);const e=entries.get(line.variantId);
    if(!p||p.status!=='active'||!e||!e.active||e.productId!==line.productId)throw new Error('cart line product/price unavailable');
    const variant=p.variants.find(v=>v.id===line.variantId&&v.active);if(!variant)throw new Error('cart variant unavailable');
    const lineSubtotal=line.quantity*e.unitPriceMinor;if(!Number.isSafeInteger(lineSubtotal))throw new Error('line total overflow');
    return {productId:line.productId,variantId:line.variantId,sku:variant.sku,quantity:line.quantity,unitPriceMinor:e.unitPriceMinor,subtotalMinor:lineSubtotal};
  });
  const subtotalMinor=priced.reduce((s,l)=>s+l.subtotalMinor,0);if(!Number.isSafeInteger(subtotalMinor))throw new Error('subtotal overflow');
  let discountMinor=0,couponCode=null;
  if(coupon){
    if(coupon.tenantId!==cart.tenantId)throw new Error('coupon tenant mismatch');
    if(coupon.expiresAt&&Date.parse(coupon.expiresAt)<=Date.now())throw new Error('coupon expired');
    if(redeemedCount>=coupon.maxRedemptions)throw new Error('coupon exhausted');
    if(subtotalMinor<coupon.minimumSubtotalMinor)throw new Error('minimum subtotal not met');
    discountMinor=coupon.kind==='percent'?Math.floor(subtotalMinor*coupon.value/10000):Math.min(subtotalMinor,coupon.value);couponCode=coupon.code;
  }
  const taxableMinor=Math.max(0,subtotalMinor-discountMinor);
  let taxMinor=0;
  if(taxPolicy){
    if(taxPolicy.tenantId!==cart.tenantId)throw new Error('tax policy tenant mismatch');
    taxMinor=Math.floor(taxableMinor*taxPolicy.rateBps/10000);
    if(taxPolicy.maxTaxMinor!==null)taxMinor=Math.min(taxMinor,taxPolicy.maxTaxMinor);
  }
  const totalMinor=taxableMinor+taxMinor;if(!Number.isSafeInteger(totalMinor)||totalMinor<0)throw new Error('cart total invalid');
  return freeze({tenantId:cart.tenantId,cartId:cart.cartId,currency:cart.currency,lines:priced,subtotalMinor,discountMinor,taxMinor,totalMinor,couponCode,priceBookId:priceBook.priceBookId,taxPolicyId:taxPolicy?.taxPolicyId??null,pricingHash:hash({cartId:cart.cartId,lines:priced,subtotalMinor,discountMinor,taxMinor,totalMinor,couponCode,priceBookId:priceBook.priceBookId,taxPolicyId:taxPolicy?.taxPolicyId??null})});
}

export function createInventoryState({tenantId,items=[]}={}){
  assertRef(tenantId,'tenantId');safeArray(items,'items',10000);const seen=new Set();
  const state=items.map(i=>{assertId(i.variantId,'variantId');if(seen.has(i.variantId))throw new TypeError('duplicate inventory item');seen.add(i.variantId);return {variantId:i.variantId,onHand:boundedInt(i.onHand,'onHand',0,100000000),reserved:boundedInt(i.reserved??0,'reserved',0,100000000)};});
  if(state.some(i=>i.reserved>i.onHand))throw new Error('reserved exceeds on hand');
  return freeze({tenantId,items:state,stateHash:hash(state)});
}

export function reserveInventory({state,lines,reservationId,ttlSeconds=900}={}){
  if(!state||!Array.isArray(state.items))throw new TypeError('inventory state required');assertRef(reservationId,'reservationId');boundedInt(ttlSeconds,'ttlSeconds',30,86400);safeArray(lines,'lines',200);
  const qty=new Map();for(const line of lines){assertId(line.variantId,'variantId');boundedInt(line.quantity,'quantity',1,100000);qty.set(line.variantId,(qty.get(line.variantId)||0)+line.quantity);}
  const next=state.items.map(item=>{const q=qty.get(item.variantId)||0;const available=item.onHand-item.reserved;if(q>available)throw new Error('insufficient inventory');return {...item,reserved:item.reserved+q};});
  const expiresAt=new Date(Date.now()+ttlSeconds*1000).toISOString();
  return freeze({tenantId:state.tenantId,reservationId,expiresAt,lines:[...qty.entries()].map(([variantId,quantity])=>({variantId,quantity})),nextState:freeze({tenantId:state.tenantId,items:next,stateHash:hash(next)}),reservationHash:hash({tenantId:state.tenantId,reservationId,expiresAt,lines:[...qty.entries()]})});
}

export function commitInventoryReservation({state,reservation}={}){
  if(!reservation||reservation.nextState?.tenantId!==state?.tenantId)throw new Error('reservation mismatch');
  if(Date.parse(reservation.expiresAt)<=Date.now())throw new Error('reservation expired');
  const qty=new Map(reservation.lines.map(x=>[x.variantId,x.quantity]));
  const items=state.items.map(item=>{const q=qty.get(item.variantId)||0;return q?{...item,onHand:item.onHand-q,reserved:item.reserved-q}:item;});
  if(items.some(i=>i.onHand<0||i.reserved<0||i.reserved>i.onHand))throw new Error('inventory invariant violated');
  return freeze({tenantId:state.tenantId,reservationId:reservation.reservationId,committedState:freeze({tenantId:state.tenantId,items,stateHash:hash(items)})});
}

export function releaseInventoryReservation({state,reservation}={}){
  if(!reservation||reservation.nextState?.tenantId!==state?.tenantId)throw new Error('reservation mismatch');
  const qty=new Map(reservation.lines.map(x=>[x.variantId,x.quantity]));
  const items=state.items.map(item=>{const q=qty.get(item.variantId)||0;const next=item.reserved-q;if(next<0)throw new Error('release exceeds reserved');return q?{...item,reserved:next}:item;});
  return freeze({tenantId:state.tenantId,reservationId:reservation.reservationId,releasedState:freeze({tenantId:state.tenantId,items,stateHash:hash(items)})});
}

export function createQuote({tenantId,quoteId,customerRef,pricing,validUntil,notes='',status='draft'}={}){
  assertRef(tenantId,'tenantId');assertRef(quoteId,'quoteId');assertRef(customerRef,'customerRef');text(notes||'','notes',3000);
  if(!pricing||pricing.tenantId!==tenantId)throw new Error('pricing mismatch');
  if(!Number.isFinite(Date.parse(validUntil)))throw new TypeError('validUntil invalid');
  if(!QUOTE_STATUS.includes(status))throw new TypeError('quote status invalid');
  const body={tenantId,quoteId,customerRef,pricing:clone(pricing),validUntil:new Date(validUntil).toISOString(),notes:notes||'',status,version:1};
  return freeze({...body,checksum:hash(body)});
}

export function transitionQuote({quote,to,expectedVersion=quote?.version}={}){
  if(!quote||quote.version!==expectedVersion)throw Object.assign(new Error('quote version conflict'),{code:'version_conflict'});
  const allowed={draft:['sent','canceled'],sent:['accepted','declined','expired','canceled'],accepted:[],declined:[],expired:[],canceled:[]};
  if(!allowed[quote.status]?.includes(to))throw Object.assign(new Error('quote transition invalid'),{code:'invalid_transition'});
  if(to==='accepted'&&Date.parse(quote.validUntil)<=Date.now())throw new Error('quote expired');
  const next={...clone(quote),status:to,version:quote.version+1,updatedAt:new Date().toISOString()};return freeze({...next,checksum:hash(next)});
}

export function createCheckoutIntent({tenantId,checkoutId,cartId,pricing,returnOrigin,idempotencyKey}={}){
  assertRef(tenantId,'tenantId');assertRef(checkoutId,'checkoutId');assertId(cartId,'cartId');idem(idempotencyKey);
  if(!pricing||pricing.tenantId!==tenantId||pricing.cartId!==cartId)throw new Error('pricing mismatch');
  const origin=new URL(text(returnOrigin,'returnOrigin',2048));if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw new Error('returnOrigin invalid');
  const body={tenantId,checkoutId,cartId,currency:pricing.currency,amountMinor:pricing.totalMinor,pricingHash:pricing.pricingHash,returnOrigin:origin.origin,idempotencyKey,status:'created'};
  return freeze({...body,checksum:hash(body)});
}

export function transitionCheckout({checkout,to}={}){
  if(!checkout||!['created','authorized','completed','canceled','failed'].includes(checkout.status))throw new Error('checkout invalid');
  const allowed={created:['authorized','canceled','failed'],authorized:['completed','canceled','failed'],completed:[],canceled:[],failed:['created']};
  if(!allowed[checkout.status].includes(to))throw Object.assign(new Error('checkout transition invalid'),{code:'invalid_transition'});
  const next={...clone(checkout),status:to,version:(checkout.version||1)+1};return freeze({...next,checksum:hash(next)});
}

export function createPaymentEvent({tenantId,paymentId,provider,eventId,status,amountMinor,currencyCode='USD',orderId=null,occurredAt=new Date().toISOString(),payloadHash}={}){
  assertRef(tenantId,'tenantId');assertRef(paymentId,'paymentId');assertId(provider,'provider');assertRef(eventId,'eventId');money(amountMinor);currency(currencyCode);
  if(!PAYMENT_STATUS.includes(status))throw new TypeError('payment status invalid');if(orderId)assertRef(orderId,'orderId');if(!payloadHash&&!/^[a-f0-9]{64}$/.test(payloadHash||''))throw new TypeError('payloadHash required');
  const dedupeKey=hash({tenantId,provider,eventId});
  const body={tenantId,paymentId,provider,eventId,status,amountMinor,currency:currencyCode,orderId,occurredAt:new Date(occurredAt).toISOString(),payloadHash,dedupeKey};
  return freeze({...body,checksum:hash(body)});
}

export function applyPaymentEvent({paymentState,event}={}){
  if(!paymentState||paymentState.tenantId!==event.tenantId)throw new Error('payment tenant mismatch');
  if(paymentState.paymentId!==event.paymentId||paymentState.currency!==event.currency)throw new Error('payment identity mismatch');
  const legal={
    requires_payment_method:['requires_action','authorized','failed'],requires_action:['authorized','failed'],
    authorized:['captured','failed'],captured:['partially_refunded','refunded'],partially_refunded:['partially_refunded','refunded'],
    failed:[],refunded:[]
  };
  if(!legal[paymentState.status]?.includes(event.status))throw Object.assign(new Error('payment transition invalid'),{code:'invalid_transition'});
  if((event.status==='captured'||event.status==='refunded'||event.status==='partially_refunded')&&event.amountMinor>paymentState.amountMinor)throw new Error('payment amount exceeds original');
  return freeze({...clone(paymentState),status:event.status,lastEventId:event.eventId,lastEventHash:event.payloadHash,version:(paymentState.version||1)+1});
}

export function createSubscription({tenantId,subscriptionId,customerRef,priceBookId,variantId,quantity=1,status='trialing',trialEndsAt=null,renewsAt=null}={}){
  assertRef(tenantId,'tenantId');assertRef(subscriptionId,'subscriptionId');assertRef(customerRef,'customerRef');assertId(priceBookId,'priceBookId');assertId(variantId,'variantId');boundedInt(quantity,'quantity',1,100000);
  if(!SUBSCRIPTION_STATUS.includes(status))throw new TypeError('subscription status invalid');
  if(trialEndsAt&&!Number.isFinite(Date.parse(trialEndsAt)))throw new TypeError('trialEndsAt invalid');
  if(renewsAt&&!Number.isFinite(Date.parse(renewsAt)))throw new TypeError('renewsAt invalid');
  const body={tenantId,subscriptionId,customerRef,priceBookId,variantId,quantity,status,trialEndsAt:trialEndsAt?new Date(trialEndsAt).toISOString():null,renewsAt:renewsAt?new Date(renewsAt).toISOString():null,version:1};
  return freeze({...body,checksum:hash(body)});
}

export function transitionSubscription({subscription,to,expectedVersion=subscription?.version,reason=''}={}){
  if(!subscription||subscription.version!==expectedVersion)throw Object.assign(new Error('subscription version conflict'),{code:'version_conflict'});
  const allowed={trialing:['active','past_due','canceled'],active:['past_due','paused','canceled'],past_due:['active','paused','canceled'],paused:['active','canceled'],canceled:[]};
  if(!allowed[subscription.status]?.includes(to))throw Object.assign(new Error('subscription transition invalid'),{code:'invalid_transition'});
  const next={...clone(subscription),status:to,reason:text(reason||'system','reason',300),version:subscription.version+1,updatedAt:new Date().toISOString()};return freeze({...next,checksum:hash(next)});
}

export function createRefundRequest({tenantId,refundId,paymentId,amountMinor,reason,idempotencyKey,requiresApprovalAboveMinor=100000,approval=null}={}){
  assertRef(tenantId,'tenantId');assertRef(refundId,'refundId');assertRef(paymentId,'paymentId');positiveMoney(amountMinor,'amountMinor');text(reason,'reason',500);idem(idempotencyKey);money(requiresApprovalAboveMinor,'requiresApprovalAboveMinor');
  const approvalRequired=amountMinor>requiresApprovalAboveMinor;if(approvalRequired&&approval?.status!=='approved')return freeze({tenantId,refundId,paymentId,amountMinor,reason,idempotencyKey,status:'needs_approval',approvalRequired:true});
  return freeze({tenantId,refundId,paymentId,amountMinor,reason,idempotencyKey,status:'approved',approvalRequired:false,refundHash:hash({tenantId,refundId,paymentId,amountMinor,reason,idempotencyKey})});
}

export function createCredit({tenantId,creditId,customerRef,amountMinor,reason,expiresAt=null}={}){
  assertRef(tenantId,'tenantId');assertRef(creditId,'creditId');assertRef(customerRef,'customerRef');positiveMoney(amountMinor,'amountMinor');text(reason,'reason',500);
  if(expiresAt!==null&&!Number.isFinite(Date.parse(expiresAt)))throw new TypeError('expiresAt invalid');
  const body={tenantId,creditId,customerRef,amountMinor,remainingMinor:amountMinor,reason,expiresAt:expiresAt?new Date(expiresAt).toISOString():null,status:'open'};
  return freeze({...body,checksum:hash(body)});
}

export function consumeCredit({credit,amountMinor,sourceRef,idempotencyKey}={}){
  if(!credit||credit.tenantId===undefined)throw new TypeError('credit required');positiveMoney(amountMinor,'amountMinor');assertRef(sourceRef,'sourceRef');idem(idempotencyKey);
  if(credit.status!=='open')throw new Error('credit not open');if(credit.expiresAt&&Date.parse(credit.expiresAt)<=Date.now())throw new Error('credit expired');if(amountMinor>credit.remainingMinor)throw new Error('credit insufficient');
  const remaining=credit.remainingMinor-amountMinor;const next={...clone(credit),remainingMinor:remaining,status:remaining===0?'consumed':'open',lastSourceRef:sourceRef,lastIdempotencyKey:idempotencyKey};return freeze({...next,checksum:hash(next)});
}

export function buildPortalScope({tenantId,portalId,portalRole,principalId,relationType,relationId,resourceGrants=[]}={}){
  assertRef(tenantId,'tenantId');assertRef(portalId,'portalId');assertRef(principalId,'principalId');assertRef(relationId,'relationId');
  if(!PORTAL_ROLES.has(portalRole))throw new TypeError('portal role invalid');assertId(relationType,'relationType');safeArray(resourceGrants,'resourceGrants',20);if(!resourceGrants.every(x=>PORTAL_RESOURCES.has(x)))throw new TypeError('portal resource invalid');
  return freeze({tenantId,portalId,portalRole,principalId,relationType,relationId,resourceGrants:[...new Set(resourceGrants)],scopeHash:hash({tenantId,portalId,portalRole,principalId,relationType,relationId,resourceGrants:[...new Set(resourceGrants)]})});
}

export function authorizePortalAction({scope,tenantId,resource,action,targetRelationId}={}){
  if(!scope||scope.tenantId!==tenantId)throw new Error('portal tenant mismatch');if(!PORTAL_RESOURCES.has(resource))throw new TypeError('resource invalid');if(!scope.resourceGrants.includes(resource))return {allowed:false,code:'RESOURCE_DENIED'};
  if(targetRelationId!==scope.relationId)return {allowed:false,code:'RELATION_SCOPE_DENIED'};
  const readOnly=new Set(['read','list','download']);if(!readOnly.has(action)&&scope.portalRole==='customer'&&resource==='payments')return {allowed:false,code:'PAYMENT_MUTATION_DENIED'};
  return {allowed:true,code:'ALLOWED'};
}

export function createProject({tenantId,projectId,name,budgetMinor=0,currencyCode='USD',status='active',members=[],tasks=[]}={}){
  assertRef(tenantId,'tenantId');assertRef(projectId,'projectId');text(name,'name',200);money(budgetMinor);currency(currencyCode);safeArray(members,'members',200);safeArray(tasks,'tasks',5000);
  const taskIds=new Set();for(const task of tasks){assertId(task.id,'taskId');if(taskIds.has(task.id))throw new TypeError('duplicate task');taskIds.add(task.id);if(!TASK_STATUS.has(task.status||'todo'))throw new TypeError('task status invalid');safeArray(task.dependencies||[],'dependencies',50);for(const dep of task.dependencies||[])if(!taskIds.has(dep))throw new Error('dependencies must reference earlier tasks');}
  const body={tenantId,projectId,name:text(name,'name',200),budgetMinor,currency:currencyCode,status,members:clone(members),tasks:clone(tasks)};return freeze({...body,checksum:hash(body)});
}

export function addProjectTask({project,taskId,title,assigneeRef=null,budgetMinor=0,dueAt=null,dependencies=[]}={}){
  if(!project||project.tenantId===undefined)throw new TypeError('project required');assertId(taskId,'taskId');text(title,'title',240);if(project.tasks.some(t=>t.id===taskId))throw new Error('duplicate task');money(budgetMinor);safeArray(dependencies,'dependencies',50);
  const existing=new Set(project.tasks.map(t=>t.id));for(const dep of dependencies)if(!existing.has(dep))throw new Error('dependency not found');if(dueAt&&!Number.isFinite(Date.parse(dueAt)))throw new TypeError('dueAt invalid');if(assigneeRef)assertRef(assigneeRef,'assigneeRef');
  const task={id:taskId,title:text(title,'title',240),assigneeRef,budgetMinor,dueAt:dueAt?new Date(dueAt).toISOString():null,dependencies:[...new Set(dependencies)],status:'todo'};
  return freeze({...clone(project),tasks:[...project.tasks,task],checksum:hash({...clone(project),tasks:[...project.tasks,task]})});
}

export function updateProjectTask({project,taskId,status=null,expectedTaskState='todo',assigneeRef=null}={}){
  if(!project||project.tenantId===undefined)throw new TypeError('project required');const task=project.tasks.find(t=>t.id===taskId);if(!task)throw new Error('task not found');if(task.status!==expectedTaskState)throw Object.assign(new Error('task state conflict'),{code:'version_conflict'});
  if(status!==null&&!TASK_STATUS.has(status))throw new TypeError('task status invalid');
  const updated={...task,status:status??task.status,assigneeRef:assigneeRef===null?task.assigneeRef:assertRef(assigneeRef,'assigneeRef')};
  if(updated.status==='done'){const blockers=project.tasks.filter(t=>updated.dependencies.includes(t.id)&&t.status!=='done');if(blockers.length)throw new Error('cannot complete task with incomplete dependencies');}
  const tasks=project.tasks.map(t=>t.id===taskId?updated:t);const body={...clone(project),tasks};return freeze({...body,checksum:hash(body)});
}

export function validateDependencyGraph({tasks=[]}={}){
  safeArray(tasks,'tasks',5000);const ids=new Set(tasks.map(t=>t.id));const indegree=new Map(tasks.map(t=>[t.id,0]));const out=new Map(tasks.map(t=>[t.id,[]]));
  for(const task of tasks){for(const dep of task.dependencies||[]){if(!ids.has(dep))return {valid:false,code:'missing_dependency',taskId:task.id,dependencyId:dep};indegree.set(task.id,indegree.get(task.id)+1);out.get(dep).push(task.id);}}
  const q=[...indegree.entries()].filter(([,d])=>d===0).map(([id])=>id);let visited=0;
  while(q.length){const id=q.shift();visited++;for(const next of out.get(id)){indegree.set(next,indegree.get(next)-1);if(indegree.get(next)===0)q.push(next);}}
  return visited===tasks.length?{valid:true,code:'acyclic'}:{valid:false,code:'dependency_cycle'};
}

export function createIdempotencyRecord({tenantId,key,scope,requestHash,resultRef,status='completed',expiresAt=null}={}){
  assertRef(tenantId,'tenantId');idem(key);assertRef(scope,'scope');assertRef(requestHash,'requestHash');assertRef(resultRef,'resultRef');
  if(!['processing','completed','failed'].includes(status))throw new TypeError('idempotency status invalid');if(expiresAt!==null&&!Number.isFinite(Date.parse(expiresAt)))throw new TypeError('expiresAt invalid');
  return freeze({tenantId,key,scope,requestHash,resultRef,status,expiresAt:expiresAt?new Date(expiresAt).toISOString():null,uniqueKey:hash({tenantId,key,scope})});
}

export function reconcileExternalEvent({tenantId,provider,providerEventId,payloadHash,resourceRef,observedAt=new Date().toISOString()}={}){
  assertRef(tenantId,'tenantId');assertId(provider,'provider');assertRef(providerEventId,'providerEventId');assertRef(payloadHash,'payloadHash');assertRef(resourceRef,'resourceRef');
  if(!/^[a-f0-9]{64}$/.test(payloadHash))throw new TypeError('payloadHash invalid');const observed=new Date(observedAt);if(Number.isNaN(observed.getTime()))throw new TypeError('observedAt invalid');
  const reconciliationKey=hash({tenantId,provider,providerEventId});
  return freeze({tenantId,provider,providerEventId,payloadHash,resourceRef,observedAt:observed.toISOString(),reconciliationKey,uniqueConstraint:'(tenant_id, provider, provider_event_id)'});
}

export const TRANSACTIONAL_CAPABILITIES=Object.freeze([
 'products','variants','sku','price_books','taxes','discounts','coupons','subscriptions','usage_billing','inventory','orders',
 'checkout','shopping_cart','payment_links','upsells','cross_sells','refunds','credits','quotes','proposals','contracts','e_signatures',
 'ticketing','helpdesk','sla','service_queues','knowledge_base','customer_feedback','csat','nps','projects','tasks','subtasks',
 'dependencies','milestones','recurring_tasks','team_assignment','time_tracking','workload','capacity','gantt',
 'customer_portal','partner_portal','freelancer_portal','agency_portal','vendor_portal','portal_scoped_authorization',
 'idempotency_ledger','provider_reconciliation','compensation_safe_state_transitions'
]);
