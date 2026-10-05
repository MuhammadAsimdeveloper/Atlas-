import assert from 'node:assert/strict';
import test from 'node:test';
import { AtlasQueueWorker } from './runtime.mjs';

const job = (id,type='test.ok') => ({ tenant_id:'tenant-a',job_id:id,job_type:type,payload_ref:{kind:'workflow',id:'wf-1'},idempotency_key:`key-${id}`,attempts:1 });
const event = (id,type='contact.created') => ({ tenant_id:'tenant-a',event_id:id,event_type:type,payload_ref:{kind:'contacts',id:'c-1',version:1},attempts:1 });

function fakeStore({ jobs=[],events=[] }={}) {
  const calls=[];
  return {
    calls,
    async reapJobs(limit) { calls.push(['reapJobs',limit]); return 0; },
    async tickSchedules(limit) { calls.push(['tickSchedules',limit]); return 0; },
    async reapOutbox(limit) { calls.push(['reapOutbox',limit]); return 0; },
    async claimJobs(workerId,limit,leaseSeconds,types) { calls.push(['claimJobs',workerId,limit,leaseSeconds,types]); return jobs.filter(item=>types.includes(item.job_type)).slice(0,limit); },
    async claimOutbox(workerId,limit,leaseSeconds,types) { calls.push(['claimOutbox',workerId,limit,leaseSeconds,types]); return events.filter(item=>types.includes(item.event_type)).slice(0,limit); },
    async heartbeatJob(item,workerId) { calls.push(['heartbeatJob',item.job_id,workerId]); return true; },
    async heartbeatOutbox(item,workerId) { calls.push(['heartbeatOutbox',item.event_id,workerId]); return true; },
    async completeJob(item,workerId) { calls.push(['completeJob',item.job_id,workerId]); return true; },
    async failJob(item,workerId,code) { calls.push(['failJob',item.job_id,workerId,code]); return 'retryable'; },
    async ackOutbox(item,workerId) { calls.push(['ackOutbox',item.event_id,workerId]); return true; },
    async failOutbox(item,workerId,code) { calls.push(['failOutbox',item.event_id,workerId,code]); return 'pending'; }
  };
}

test('worker executes only registered types, carries stable idempotency and acknowledges outbox after delivery', async () => {
  const store=fakeStore({jobs:[job('job-1'),job('job-unknown','test.other')],events:[event('event-1')]});
  const logs=[];
  const worker=new AtlasQueueWorker({
    store,workerId:'worker-1',concurrency:2,
    jobHandlers:{'test.ok':async (ref,context)=>{ assert.equal(ref.id,'wf-1'); assert.equal(context.idempotencyKey,'key-job-1'); assert.equal(context.attempt,1); }},
    eventHandlers:{'contact.created':async (ref,context)=>{ assert.equal(ref.kind,'contacts'); assert.equal(context.eventId,'event-1'); }},
    logger:{warn:value=>logs.push(value),error:value=>logs.push(value)}
  });
  const result=await worker.runOnce();
  assert.equal(result.jobsClaimed,1);
  assert.equal(result.eventsClaimed,1);
  assert.equal(result.jobsSucceeded,1);
  assert.equal(result.eventsAcknowledged,1);
  assert.deepEqual(store.calls.find(call=>call[0]==='claimJobs')[4],['test.ok']);
  assert.deepEqual(store.calls.find(call=>call[0]==='claimOutbox')[4],['contact.created']);
  assert.equal(store.calls.some(call=>call[0]==='failJob'),false);
  assert.deepEqual(logs,[]);
});

test('worker records bounded error codes and never logs handler error text or payload', async () => {
  const store=fakeStore({jobs:[job('job-secret')]});
  const logs=[];
  const worker=new AtlasQueueWorker({store,workerId:'worker-2',jobHandlers:{'test.ok':async()=>{throw Object.assign(new Error('private customer content'),{code:'provider_timeout'});}},logger:{warn:value=>logs.push(value)}});
  const result=await worker.runOnce();
  assert.equal(result.jobsFailed,1);
  assert.ok(store.calls.some(call=>call[0]==='failJob'&&call[3]==='provider_timeout'));
  assert.match(logs[0],/provider_timeout/);
  assert.doesNotMatch(logs[0],/private customer content|wf-1/);
});

test('worker shutdown wakes a long polling delay and refuses to claim without configured handlers', async () => {
  const empty=fakeStore();
  const unconfigured=new AtlasQueueWorker({store:empty,workerId:'worker-3',jobHandlers:{}});
  await assert.rejects(unconfigured.run(),/No Atlas execution or outbox handlers/);

  const worker=new AtlasQueueWorker({store:fakeStore(),workerId:'worker-4',jobHandlers:{'test.ok':async()=>{}},pollMs:60_000,logger:{}});
  const running=worker.run();
  await new Promise(resolve=>setTimeout(resolve,15));
  await worker.stop();
  const result=await Promise.race([running,new Promise((_,reject)=>setTimeout(()=>reject(new Error('worker did not drain promptly')),500))]);
  assert.equal(result.jobsSucceeded,0);
});


test('worker emits per-job SLO samples and evaluates enabled runtime policies', async () => {
  const store=fakeStore({jobs:[job('job-slo')]});
  store.calls = [];
  store.recordRuntimeSlo = async args => { store.calls.push(['recordRuntimeSlo',args]); return { sample_id:'sample' }; };
  store.listRuntimeSloPolicies = async () => [{ policy_id:'runtime.job-duration' }];
  store.evaluateRuntimeSlo = async args => { store.calls.push(['evaluateRuntimeSlo',args]); return { status:'ok' }; };
  const worker=new AtlasQueueWorker({
    store,workerId:'worker-slo',runtimePoolId:'pool-prod',sloEvaluationIntervalMs:5_000,
    jobHandlers:{'test.ok':async()=>{}},logger:{warn:()=>{},error:()=>{}}
  });
  await worker.runOnce();
  const samples=store.calls.filter(call=>call[0]==='recordRuntimeSlo');
  assert.ok(samples.some(call=>call[1].metric==='job_duration_ms' && call[1].target===30_000));
  assert.ok(samples.some(call=>call[1].metric==='success_rate' && call[1].value===1));
  assert.ok(samples.some(call=>call[1].metric==='error_rate' && call[1].value===0));
  assert.ok(store.calls.some(call=>call[0]==='evaluateRuntimeSlo' && call[1].poolId==='pool-prod'));
});
