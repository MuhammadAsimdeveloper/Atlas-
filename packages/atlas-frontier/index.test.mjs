import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createProviderAdapter, validateProviderContract, createSyncCursor, advanceSyncCursor,
 createWebhookReceipt, claimWebhook, createQueueJob, leaseJob, heartbeatJob, completeJob,
 reclaimExpiredLease, claimQueueIdempotency, buildOtlpSpan, buildOtlpTraceRequest, calculateSlo,
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
 const baseNow=Date.now()+1000;
 const leased=leaseJob(j,{workerId:'w1',now:baseNow,leaseMs:100});
 assert.equal(heartbeatJob(leased,{workerId:'w1',now:baseNow+10}).workerId,'w1');
 assert.equal(completeJob(leased,{workerId:'w1',success:false,error:'x',now:baseNow+20}).status,'queued');
 assert.equal(reclaimExpiredLease({...leased,leasedUntil:new Date(0).toISOString()},{now:baseNow+101}).status,'queued');
});

test('V88 OTLP and SLO primitives expose stable contracts',()=>{
 const payload=buildOtlpTraceRequest([buildOtlpSpan({traceId:'0123456789abcdef0123456789abcdef',spanId:'0123456789abcdef',name:'atlas.queue.lease',startTimeUnixNano:1,endTimeUnixNano:2})]);
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

test('queue completion and heartbeat require a live lease owned by the worker',()=>{
 const job=createQueueJob({tenantId:'t1',queue:'sync',type:'pull'}),now=Date.now()+1000;
 const leased=leaseJob(job,{workerId:'worker-a',now,leaseMs:50});
 assert.throws(()=>completeJob(leased,{workerId:'worker-b',success:true,now:now+1}),/does not own/);
 assert.throws(()=>heartbeatJob(leased,{workerId:'worker-a',now:now+51}),/expired/);
 assert.throws(()=>completeJob(leased,{workerId:'worker-a',success:true,now:now+51}),/expired/);
});

test('queue leases cannot run before scheduled availability and payloads reject credentials',()=>{
 const job=createQueueJob({tenantId:'t1',queue:'mail',type:'send',payload:{to:'person@example.com'}});
 assert.throws(()=>leaseJob(job,{workerId:'w1',now:0}),/not available/);
 assert.throws(()=>createQueueJob({tenantId:'t1',queue:'mail',type:'send',payload:{accessToken:'secret'}}),/credential fields/);
 assert.throws(()=>createQueueJob({tenantId:'t1',queue:'mail',type:'send',maxAttempts:0}),/maxAttempts/);
});

test('webhook idempotency uses collision-safe composite keys',()=>{
 const store=new Map();
 const first=createWebhookReceipt({tenantId:'a:b',connectorId:'c',eventId:'d'});
 const second=createWebhookReceipt({tenantId:'a',connectorId:'b:c',eventId:'d'});
 assert.equal(claimWebhook(store,first).accepted,true);
 assert.equal(claimWebhook(store,second).accepted,true);
});

test('OTLP scrubs private fields and rejects malformed span identifiers',()=>{
 const span=buildOtlpSpan({traceId:'0123456789abcdef0123456789abcdef',spanId:'0123456789abcdef',name:'agent.run',startTimeUnixNano:1,endTimeUnixNano:2,attributes:{'user.email':'person@example.com','message.body':'private text',attempt:2}});
 assert.equal(span.attributes[0].value.stringValue,'[REDACTED]');
 assert.equal(span.attributes[1].value.stringValue,'[REDACTED]');
 assert.equal(span.attributes[2].value.doubleValue,2);
 assert.throws(()=>buildOtlpSpan({traceId:'t',spanId:'s',name:'bad',startTimeUnixNano:1,endTimeUnixNano:2}),/valid hexadecimal/);
});

test('empty or malformed SLO windows never report healthy',()=>{
 assert.equal(calculateSlo({good:0,total:0}).withinSlo,false);
 assert.throws(()=>calculateSlo({good:3,total:2}),/counts/);
 assert.throws(()=>calculateSlo({good:1,total:2,target:1.2}),/target/);
});

test('customer graph rejects edges to foreign or unknown nodes',()=>{
 const graph=createCustomerGraph({tenantId:'t1'});
 const one=upsertGraphNode(graph,{id:'one',type:'customer'});
 assert.throws(()=>upsertGraphEdge(one,{from:'one',to:'foreign',type:'owns'}),/endpoints/);
 assert.throws(()=>createCustomerGraph({tenantId:'t1',nodes:[{id:'x',type:'customer',tenantId:'t2'}]}),/tenant boundary/);
 assert.equal(graphPath(one,'missing','missing'),null);
});

test('revenue projection ignores future activities and malformed amounts',()=>{
 const now=Date.now();
 const result=buildRevenueCockpit({now,deals:[{amount:'bad',probability:1,status:'won'},{amount:100,probability:1,status:'won'}],customers:[],activities:[{createdAt:new Date(now+1000).toISOString()},{createdAt:new Date(now-1000).toISOString()}]});
 assert.equal(result.pipeline.total,100);
 assert.equal(result.pipeline.wonValue,100);
 assert.equal(result.engagement.recentActivities,1);
 assert.throws(()=>scoreCustomerHealth({engagement:Infinity}),/finite/);
});
