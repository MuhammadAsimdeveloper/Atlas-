import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createProviderAdapter, validateProviderContract, createSyncCursor, advanceSyncCursor,
 createWebhookReceipt, claimWebhook, createQueueJob, leaseJob, heartbeatJob, completeJob,
 reclaimExpiredLease, claimQueueIdempotency, buildOtlpTraceRequest, calculateSlo,
 createCustomerGraph, upsertGraphNode, upsertGraphEdge, graphPath, scoreCustomerHealth,
 buildRevenueCockpit, deriveBusinessGraph
} from './index.mjs';

test('V86 adapter and sync contracts are deterministic',()=>{
 const a=createProviderAdapter({id:'crm',provider:'generic',capabilities:['contacts.read']});
 assert.equal(validateProviderContract(a,['contacts.read']).ok,true);
 assert.equal(validateProviderContract(a,['deals.write']).ok,false);
 let c=createSyncCursor({tenantId:'t1',connectorId:'c1',resource:'contacts'});
 c=advanceSyncCursor(c,{cursorValue:'42',records:3});
 assert.equal(c.records,3);
 const receipt=createWebhookReceipt({tenantId:'t1',connectorId:'c1',eventId:'e1'});
 const store=new Map();
 assert.equal(claimWebhook(store,receipt).accepted,true);
 assert.equal(claimWebhook(store,receipt).duplicate,true);
});

test('V87 queue lease, heartbeat, retry and idempotency',()=>{
 const j=createQueueJob({tenantId:'t1',queue:'sync',type:'contacts.pull',idempotencyKey:'k',maxAttempts:2});
 const keys=new Map();
 assert.equal(claimQueueIdempotency(keys,j).accepted,true);
 assert.equal(claimQueueIdempotency(keys,{...j,id:'other'}).accepted,false);
 const leased=leaseJob(j,{workerId:'w1',now:0,leaseMs:100});
 assert.equal(heartbeatJob(leased,{workerId:'w1',now:10}).workerId,'w1');
 assert.equal(completeJob(leased,{success:false,error:'x',now:20}).status,'queued');
 assert.equal(reclaimExpiredLease({...leased,leasedUntil:new Date(0).toISOString()},{now:1}).status,'queued');
});

test('V88 OTLP and SLO primitives expose stable contracts',()=>{
 const payload=buildOtlpTraceRequest([{traceId:'t',spanId:'s',name:'atlas.queue.lease',startTimeUnixNano:1,endTimeUnixNano:2}]);
 assert.equal(payload.resourceSpans[0].scopeSpans[0].spans[0].name,'atlas.queue.lease');
 assert.equal(calculateSlo({good:995,total:1000,target:.99}).withinSlo,true);
});

test('V89/V90 graph and revenue contracts remain tenant-bound',()=>{
 let g=createCustomerGraph({tenantId:'t1'});
 g=upsertGraphNode(g,{id:'customer:1',type:'customer'});
 g=upsertGraphNode(g,{id:'deal:1',type:'deal'});
 g=upsertGraphEdge(g,{from:'customer:1',to:'deal:1',type:'owns'});
 assert.deepEqual(graphPath(g,'customer:1','deal:1'),['customer:1','deal:1']);
 assert.equal(scoreCustomerHealth({engagement:1,productUsage:1}).band,'healthy');
 const revenue=buildRevenueCockpit({deals:[{amount:100,probability:1,status:'won'}],customers:[{status:'active',healthBand:'healthy'}]});
 assert.equal(revenue.pipeline.wonValue,100);
 assert.equal(deriveBusinessGraph({customerGraph:g,revenue}).tenantId,'t1');
});
