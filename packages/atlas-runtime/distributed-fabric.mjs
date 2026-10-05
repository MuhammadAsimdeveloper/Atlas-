import { createHash, randomUUID } from 'node:crypto';

const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const JOB=/^[a-z][a-z0-9_.-]{1,79}$/;
const sha256=v=>createHash('sha256').update(v).digest('hex');

export class RedisTransport {
  constructor({client,namespace='atlas'}={}) {
    if (!client || typeof client.lpush!=='function' || typeof client.brpop!=='function') throw new TypeError('A Redis client with lpush/brpop is required.');
    if(!ID.test(namespace)) throw new TypeError('Redis namespace is invalid.');
    this.client=client; this.namespace=namespace;
  }
  key(queue,priority=0){if(!JOB.test(queue)||!Number.isInteger(priority)||priority<0||priority>9)throw new TypeError('Queue or priority is invalid.');return `${this.namespace}:q:${queue}:p${priority}`;}
  async publish(queue,envelope,priority=5){const body=JSON.stringify(envelope);if(body.length>64_000)throw new TypeError('Dispatch envelope exceeds 64KiB.');return this.client.lpush(this.key(queue,priority),body);}
  async receive(queues,timeoutSeconds=1){if(!Array.isArray(queues)||!queues.length)throw new TypeError('At least one queue is required.');const keys=[];for(const q of queues)for(let p=9;p>=0;p--)keys.push(this.key(q,p));const result=await this.client.brpop(...keys,timeoutSeconds);return result?.[1]?JSON.parse(result[1]):null;}
}

export function createDispatchEnvelope({tenantId,jobId,jobType,idempotencyKey,attempt=1,payloadRef={},traceId=randomUUID()}){
 if(!ID.test(tenantId)||!ID.test(jobId)||!JOB.test(jobType)||!/^[a-f0-9]{64}$/.test(idempotencyKey))throw new TypeError('Invalid durable job identity.');
 return Object.freeze({schema:1,tenantId,jobId,jobType,idempotencyKey,attempt,payloadRef,traceId,createdAt:new Date().toISOString(),envelopeHash:sha256(JSON.stringify({tenantId,jobId,jobType,idempotencyKey,attempt,payloadRef}))});
}

export class DurableDispatchController {
 constructor({store,transport=null,logger=console}={}){if(!store)throw new TypeError('Durable store is required.');this.store=store;this.transport=transport;this.logger=logger;}
 async dispatch(job,{priority=5}={}) {
   const envelope=createDispatchEnvelope(job);
   if(!this.transport)return {mode:'postgres',published:false,envelope};
   try{await this.transport.publish(job.jobType,envelope,priority);return {mode:'redis',published:true,envelope};}
   catch(error){this.logger.warn?.(`Redis dispatch degraded to PostgreSQL: ${error?.message||'unknown'}`);if(typeof this.store.recordDispatchFallback==='function'){await this.store.recordDispatchFallback(envelope,job.jobType,priority).catch(()=>{});}return {mode:'postgres',published:false,envelope};}
 }
 async recover(queueTypes,limit=100){const jobs=await this.store.claimJobs('__dispatch-recovery__',limit,60,queueTypes);return jobs.map(j=>createDispatchEnvelope({tenantId:j.tenant_id,jobId:j.job_id,jobType:j.job_type,idempotencyKey:j.idempotency_key,attempt:j.attempts,payloadRef:j.payload_ref}));}
}

export function computeScaleDecision({queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining,minWorkers,maxWorkers,now=Date.now(),lastScaleAt=0,cooldownMs=60_000}){
 for(const [k,v] of Object.entries({queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining,minWorkers,maxWorkers}))if(!Number.isFinite(v))throw new TypeError(`${k} must be finite.`);
 if(!Number.isInteger(minWorkers)||!Number.isInteger(maxWorkers)||minWorkers<1||maxWorkers<minWorkers)throw new TypeError('Worker bounds are invalid.');
 if(now-lastScaleAt<cooldownMs)return {action:'hold',targetWorkers:Math.max(minWorkers,Math.min(maxWorkers,activeWorkers)),reason:'cooldown'};
 const pressure=queueDepth>Math.max(10,activeWorkers*10)||workerUtilization>=0.8;
 const healthy=sloErrorBudgetRemaining>0.2;
 if(pressure&&healthy)return {action:'scale_up',targetWorkers:Math.min(maxWorkers,Math.max(activeWorkers+1,Math.ceil(activeWorkers*1.5))),reason:'queue_or_utilization_pressure'};
 if(queueDepth===0&&workerUtilization<0.2&&activeWorkers>minWorkers&&sloErrorBudgetRemaining>0.5)return {action:'scale_down',targetWorkers:Math.max(minWorkers,activeWorkers-1),reason:'idle_capacity'};
 return {action:'hold',targetWorkers:Math.max(minWorkers,Math.min(maxWorkers,activeWorkers)),reason:'within_bounds'};
}

export function evaluateFailover({redisHealthy,postgresHealthy,workerHeartbeatAgeMs,leaseAgeMs,now=Date.now(),heartbeatTimeoutMs=30_000,leaseTimeoutMs=90_000}){
 if(!postgresHealthy)return {state:'database_unavailable',claimingAllowed:false,redisPublishAllowed:false,recovery:'pause_and_retry'};
 if(workerHeartbeatAgeMs>heartbeatTimeoutMs&&leaseAgeMs>leaseTimeoutMs)return {state:'worker_failed',claimingAllowed:true,redisPublishAllowed:redisHealthy,recovery:'reclaim_expired_leases'};
 if(!redisHealthy)return {state:'redis_degraded',claimingAllowed:true,redisPublishAllowed:false,recovery:'postgres_fallback'};
 return {state:'healthy',claimingAllowed:true,redisPublishAllowed:true,recovery:'normal'};
}

export function buildOtlpSpan({name,startTimeUnixNano,endTimeUnixNano,traceId=randomUUID().replaceAll('-','').slice(0,32),spanId=randomUUID().replaceAll('-','').slice(0,16),attributes={}}){
 if(!name||!Number.isSafeInteger(startTimeUnixNano)||!Number.isSafeInteger(endTimeUnixNano)||endTimeUnixNano<startTimeUnixNano)throw new TypeError('OTLP span timing is invalid.');
 return {traceId,spanId,name,startTimeUnixNano,endTimeUnixNano,attributes:Object.fromEntries(Object.entries(attributes).slice(0,32).map(([k,v])=>[k,String(v).slice(0,512)]))};
}

export function deploymentReadiness({postgres,redis,secretResolver,waf,backup,pitr,restoreDrill,loadTest,providerCredentials,publicOrigin}){
 const checks={postgres,redis,secretResolver,waf,backup,pitr,restoreDrill,loadTest,providerCredentials,publicOrigin};
 const missing=Object.entries(checks).filter(([,v])=>v!==true).map(([k])=>k);
 return Object.freeze({ready:missing.length===0,missing,checks});
}
