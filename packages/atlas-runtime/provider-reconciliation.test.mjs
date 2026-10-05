import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderReconciler } from './provider-reconciliation.mjs';

function store(initial={state:'pending',provider_ref:null}){const calls=[];return{
 calls,
 async startProviderAction(){calls.push(['start']);return initial;},
 async recordProviderOutcome(x){calls.push(['outcome',x]);return true;}
};}

test('successful prior provider action is never resent',async()=>{
 const s=store({state:'sent',provider_ref:'provider-123'});const r=new ProviderReconciler({store:s});
 const out=await r.handleExisting({record:{state:'sent',provider_ref:'provider-123'},adapter:{send:async()=>{throw new Error('must not send')}},context:{idempotencyKey:'k'}});
 assert.equal(out.providerRef,'provider-123');
});

test('ambiguous provider outcome blocks resend without lookup',async()=>{
 const s=store({});const r=new ProviderReconciler({store:s});
 await assert.rejects(r.handleExisting({record:{state:'ambiguous'},adapter:{},context:{idempotencyKey:'k'}}),/reconciliation/);
});

test('provider lookup reconciles an ambiguous outcome',async()=>{
 const s=store({});const r=new ProviderReconciler({store:s});
 const out=await r.handleExisting({
  record:{state:'ambiguous',provider_ref:null},
  adapter:{lookup:async()=>({status:'sent',providerRef:'p-1'})},
  context:{idempotencyKey:'k'},
  job:{tenant_id:'tenant',job_id:'job'}
 });
 assert.equal(out.reconciled,true);
 assert.equal(s.calls[0][0],'outcome');
 assert.equal(s.calls[0][1].resolutionCode,'provider_lookup_confirmed');
});

test('stable provider action identity is deterministic',()=>{
 assert.equal(ProviderReconciler.stableActionId({tenantId:'tenant',idempotencyKey:'k'}),ProviderReconciler.stableActionId({tenantId:'tenant',idempotencyKey:'k'}));
 assert.notEqual(ProviderReconciler.stableActionId({tenantId:'other',idempotencyKey:'k'}),ProviderReconciler.stableActionId({tenantId:'tenant',idempotencyKey:'k'}));
});
