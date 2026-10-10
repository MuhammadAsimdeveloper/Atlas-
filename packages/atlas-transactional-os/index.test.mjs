import test from 'node:test';
import assert from 'node:assert/strict';
import {
 defineProduct,definePriceBook,defineTaxPolicy,defineCoupon,createCart,priceCart,createOrder,
 createInventoryState,reserveInventory,commitInventoryReservation,releaseInventoryReservation,
 createQuote,transitionQuote,createCheckoutIntent,transitionCheckout,createPaymentEvent,applyPaymentEvent,
 createSubscription,transitionSubscription,createRefundRequest,createCredit,consumeCredit,
 buildPortalScope,authorizePortalAction,createProject,addProjectTask,updateProjectTask,validateDependencyGraph,
 createIdempotencyRecord,reconcileExternalEvent,TRANSACTIONAL_CAPABILITIES
} from './index.mjs';

const tenantId='tenant_1';

test('product, price book, tax and coupon compose into deterministic cart pricing',()=>{
 const product=defineProduct({tenantId,productId:'course-a',name:'Course A',type:'digital',variants:[{id:'basic',sku:'COURSE-BASIC'}]});
 const priceBook=definePriceBook({tenantId,priceBookId:'default',name:'Default',entries:[{productId:'course-a',variantId:'basic',unitPriceMinor:10000}]});
 const tax=defineTaxPolicy({tenantId,taxPolicyId:'us',name:'Tax',rateBps:500});
 const coupon=defineCoupon({tenantId,couponId:'SAVE10',code:'save10',kind:'percent',value:1000});
 const cart=createCart({tenantId,cartId:'cart-1',customerRef:'customer-1',lines:[{productId:'course-a',variantId:'basic',quantity:2}]});
 const priced=priceCart({cart,products:[product],priceBook,taxPolicy:tax,coupon});
 assert.equal(priced.subtotalMinor,20000);assert.equal(priced.discountMinor,2000);assert.equal(priced.taxMinor,900);assert.equal(priced.totalMinor,18900);
});

test('inventory reservations are pure state transitions and enforce available stock',()=>{
 const state=createInventoryState({tenantId,items:[{variantId:'basic',onHand:5}]});
 const r=reserveInventory({state,lines:[{variantId:'basic',quantity:3}],reservationId:'res-1'});
 assert.equal(r.nextState.items[0].reserved,3);
 assert.equal(commitInventoryReservation({state,reservation:r}).committedState.items[0].onHand,2);
 const rel=releaseInventoryReservation({state:r.nextState,reservation:r});
 assert.equal(rel.releasedState.items[0].reserved,0);
 assert.throws(()=>reserveInventory({state:r.nextState,lines:[{variantId:'basic',quantity:3}],reservationId:'res-2'}),/insufficient/);
});

test('quote and checkout state machines reject invalid transitions',()=>{
 const product=defineProduct({tenantId,productId:'p',name:'Product',variants:[{id:'v',sku:'SKU'}]});
 const pb=definePriceBook({tenantId,priceBookId:'pb',name:'PB',entries:[{productId:'p',variantId:'v',unitPriceMinor:5000}]});
 const cart=createCart({tenantId,cartId:'c',lines:[{productId:'p',variantId:'v',quantity:1}]});
 const pricing=priceCart({cart,products:[product],priceBook:pb});
 const quote=createQuote({tenantId,quoteId:'q1',customerRef:'cust',pricing,validUntil:new Date(Date.now()+600000).toISOString()});
 assert.equal(transitionQuote({quote,to:'sent'}).status,'sent');
 assert.throws(()=>transitionQuote({quote,to:'accepted'}),/transition/);
 const checkout=createCheckoutIntent({tenantId,checkoutId:'co1',cartId:'c',pricing,returnOrigin:'https://atlas.example.com',idempotencyKey:'checkout-12345678'});
 assert.equal(transitionCheckout({checkout,to:'authorized'}).status,'authorized');
 assert.throws(()=>transitionCheckout({checkout,to:'completed'}),/transition/);
});

test('payments are provider-event idempotent and state transitions are bounded',()=>{
 const state={tenantId,paymentId:'pay-1',currency:'USD',amountMinor:10000,status:'authorized',version:1};
 const event=createPaymentEvent({tenantId,paymentId:'pay-1',provider:'stripe',eventId:'evt-1',status:'captured',amountMinor:10000,payloadHash:'a'.repeat(64)});
 assert.equal(applyPaymentEvent({paymentState:state,event}).status,'captured');
 assert.equal(event.dedupeKey,createPaymentEvent({tenantId,paymentId:'pay-1',provider:'stripe',eventId:'evt-1',status:'captured',amountMinor:10000,payloadHash:'a'.repeat(64)}).dedupeKey);
 assert.throws(()=>applyPaymentEvent({paymentState:state,event:{...event,status:'refunded',amountMinor:11000}}),/exceeds/);
});

test('subscriptions and refunds require safe state transitions / approval',()=>{
 const sub=createSubscription({tenantId,subscriptionId:'sub-1',customerRef:'cust',priceBookId:'pb',variantId:'v'});
 assert.equal(transitionSubscription({subscription:sub,to:'active'}).status,'active');
 assert.equal(createRefundRequest({tenantId,refundId:'r1',paymentId:'p1',amountMinor:200000,reason:'large refund',idempotencyKey:'refund-12345678'}).status,'needs_approval');assert.throws(()=>createRefundRequest({tenantId,refundId:'r2',paymentId:'p1',amountMinor:9000,capturedMinor:10000,alreadyRefundedMinor:2000,reason:'over balance',idempotencyKey:'refund-12345679'}),/refundable balance/);
});

test('credits and portals are relationship scoped',()=>{
 const credit=createCredit({tenantId,creditId:'cr1',customerRef:'cust',amountMinor:5000,reason:'service recovery'});
 assert.equal(consumeCredit({credit,amountMinor:2000,sourceRef:'invoice-1',idempotencyKey:'credit-12345678'}).remainingMinor,3000);
 const scope=buildPortalScope({tenantId,portalId:'portal-1',portalRole:'customer',principalId:'user-1',relationType:'customer_account',relationId:'cust',resourceGrants:['records','tasks','payments']});
 assert.equal(authorizePortalAction({scope,tenantId,resource:'records',action:'read',targetRelationId:'cust'}).allowed,true);
 assert.equal(authorizePortalAction({scope,tenantId,resource:'payments',action:'refund',targetRelationId:'cust'}).code,'PAYMENT_MUTATION_DENIED');
 assert.equal(authorizePortalAction({scope,tenantId,resource:'records',action:'read',targetRelationId:'other'}).code,'RELATION_SCOPE_DENIED');
});

test('projects enforce acyclic, ordered dependencies and blockers',()=>{
 const project=createProject({tenantId,projectId:'p1',name:'Project',budgetMinor:100000,tasks:[
   {id:'t1',title:'First',status:'done',dependencies:[]},
   {id:'t2',title:'Second',status:'todo',dependencies:['t1']}
 ]});
 assert.equal(validateDependencyGraph({tasks:project.tasks}).valid,true);
 const updated=updateProjectTask({project,taskId:'t2',status:'done',expectedTaskState:'todo'});
 assert.equal(updated.tasks.find(t=>t.id==='t2').status,'done');
 assert.equal(addProjectTask({project:updated,taskId:'t3',title:'Third',dependencies:['t2']}).tasks.length,3);
 assert.equal(validateDependencyGraph({tasks:[{id:'a',dependencies:['b']},{id:'b',dependencies:['a']}]}).code,'dependency_cycle');
});

test('idempotency/reconciliation are durable-record contracts, not process memory',()=>{
 const i=createIdempotencyRecord({tenantId,key:'req-12345678',scope:'payment.capture',requestHash:'hash-1',resultRef:'payment-1'});
 assert.equal(i.uniqueKey.length,64);
 const e=reconcileExternalEvent({tenantId,provider:'stripe',providerEventId:'evt-1',payloadHash:'b'.repeat(64),resourceRef:'payment-1'});
 assert.equal(e.reconciliationKey.length,64);
 assert.equal(e.uniqueConstraint,'(tenant_id, provider, provider_event_id)');
});

test('transactional capability catalog covers the next-stage product surface',()=>assert.ok(TRANSACTIONAL_CAPABILITIES.length>=45));

test('inventory reservations reject stale state and bind commits to the reserved snapshot',()=>{
 const state=createInventoryState({tenantId,items:[{variantId:'basic',onHand:5}]});
 const reservation=reserveInventory({state,lines:[{variantId:'basic',quantity:3}],reservationId:'res-guard'});
 assert.throws(()=>commitInventoryReservation({state:createInventoryState({tenantId,items:[{variantId:'basic',onHand:6}]}),reservation}),/state changed/i);
 const committed=commitInventoryReservation({state:reservation.nextState,reservation});
 assert.equal(committed.committedState.items[0].onHand,2);
 assert.equal(committed.committedState.items[0].reserved,0);
});

test('orders bind tenant, customer, immutable pricing hash and bounded status',()=>{
 const pricing={currency:'USD',totalMinor:2500,pricingHash:'a'.repeat(64)};
 const order=createOrder({tenantId,orderId:'order_1',customerRef:'customer_1',pricing,inventoryReservationId:'reserve_1'});
 assert.equal(order.totalMinor,2500);
 assert.equal(order.pricingHash,pricing.pricingHash);
 assert.equal(order.status,'draft');
 assert.equal(order.checksum.length,64);
 assert.throws(()=>createOrder({tenantId,orderId:'order_2',customerRef:'customer_1',pricing,status:'captured'}),/status/i);
 assert.throws(()=>createOrder({tenantId,orderId:'order_3',customerRef:'customer_1',pricing:{currency:'EUR',totalMinor:2}}),/currency/i);
});
